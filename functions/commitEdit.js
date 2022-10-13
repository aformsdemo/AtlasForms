/* This is used to commit or cancel an edit - if untypedupdates is
not supplied or empty , then no changes are made except the unlock*/

exports = async function(namespace,_id,untypedUpdates){
  let rval = { commitSuccess: false }
  let postCommit;
    
    if(_id == undefined) {
      return rval;   
  }

  const utilityFunctions =  await context.functions.execute("utility_functions")
  const objSchema =  await context.functions.execute("getDocTypeSchemaInfo",namespace)


    const [databaseName,collectionName] = namespace.split('.');
    //TODO - verify we have permission to write to this
    const collection = context.services.get("mongodb-atlas").db(databaseName).collection(collectionName);
      
    //TODO - any server side change like a 'last update date'
    
    if(!databaseName || !collectionName) { return rval;}
    
    
    let user = context.user;
    let email = user.data.email;
    
    //Cannot unlock it if it's not mine  
    let isLockedByMe = { __lockedby : email };
    let checkLock = { _id, $or : [ isLockedByMe] };
    
    /*
    let deletepulls = {}
    try {
       // MongoDB doesn't have a way of removing array elements by position - and with multiple editing processes
       // That could cause a race condition anyway, normally we would remove by value
      // As we are explicitly locking we are going to first update them to "$$REMOVE" is we have any then $pull them
      // in the unlocking update.
      // Also - you can only apply one update operator to a field per time so we cannot use $pull in the second
      // update if we have thigns to set - therefor we will do any calls to $set on the fields with deletes in This
      // first update.
      let requiredsets = {}
      let arraydeletes = {}

      for( let field of Object.keys(untypedUpdates) )
      {
        if(untypedUpdates[field] == "$$REMOVE") {
          arraydeletes[field] = "$$REMOVE"
          delete untypedUpdates[field]
          //Get the field name without the index
          const basename = field.split('.')[0]
          deletepulls[basename] = "$$REMOVE"
        }
      }
      
      let markForDelete = { $set: arraydeletes };
      await collection.updateOne(checkLock,{$set:arraydeletes});
    
    } catch(e) {
       console.log(e);
      //We couldn't find it or we weren't editing it that's OK - maybe it was stolen
       postCommit = await collection.findOne({_id},{__locked:0,__lockedby:0,__locktime:0});
       rval.currentDoc = postCommit;
    } 
    */
    
    
    // Convert everything to the correct Javascript/BSON type 
    // As it's all sent as strings from the form, 
    // also sanitises any Javascript injection
    let updates = {}
    let deletepulls = {}
    
    if(untypedUpdates != null) {
      
      for( let field of Object.keys(untypedUpdates) )
      {
          // MongoDB doesn't have a way of removing array elements by position - and with multiple editing processes
          // That could cause a race condition anyway, normally we would remove by value
          // As we are explicitly locking we are going to first update them to "$$REMOVE" is we have any then $pull them
          // in a second unlocking update.
    
         if(untypedUpdates[field] == "$$REMOVE") {
          updates[field] = "$$REMOVE" //Explicity make it this string - maybe should be null though
          //Get the field name without the index and mark it as needing $$REMOVE's pulled
          const basename = field.split('.')[0]
          deletepulls[basename] = "$$REMOVE"
        } else 
        {
          let parts = field.split('.')
          let subobj = objSchema
          for(let part of parts) {
            //This could be field objectfield.member arrayfield.index or arrayfield.index.member
            //In the schema it's always field or field.0.member
            if(!isNaN(part) ) {
              //!isNaN == isNumber
              part='0';
            }
            subobj = subobj[part]
          }
          //Now based on that convert value and add to our new query
          let correctlyTypedValue = utilityFunctions.correctValueType(untypedUpdates[field],subobj)
          if(correctlyTypedValue == null) {
            console.log(EJSON.stringify(untypedUpdates))
            console.error(`Bad Record Summitted - cannot convert ${field}`)
            
      
            //Check here and if we cannot cast the value sent to the correct data type
            //When inserting or updating - so they types yes in a numeric field for example
            //We should raise an error
            return rval;
          }
          updates[field] = correctlyTypedValue
        }
      }
      
      
    }

    let unlockRecord = { $unset : { __locked: 1, __lockedby: 1, __locktime: 1}};
    let sets = {$set: updates}
    let pulls = {$pull: deletepulls};
    

    try {
      if(deletepulls.length == 0 )
      {
        postCommit = await collection.findOneAndUpdate(checkLock,{ ...sets,...unlockRecord},{returnNewDocument: true});
        rval.commitSuccess = true;
        rval.currentDoc = postCommit;
      } else {
        await collection.updateOne(checkLock,sets,{returnNewDocument: true});
        postCommit = await collection.findOneAndUpdate(checkLock,{ ...deletepulls,...unlockRecord},{returnNewDocument: true});
        rval.commitSuccess = true;
        rval.currentDoc = postCommit;
      }
    } catch(e) {
      console.log(e);
      //We couldn't find it or we weren't editing it that's OK - maybe it was stolen
       postCommit = await collection.findOne({_id},{__locked:0,__lockedby:0,__locktime:0});
       rval.currentDoc = postCommit;
    } 
    return rval;

};