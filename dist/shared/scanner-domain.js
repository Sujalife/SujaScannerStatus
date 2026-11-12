/* Pure scanner transitions. Firebase rules remain the authority for stored writes. */
export const SCANNER_IDS=Object.freeze(Array.from({length:20},(_,index)=>`SCNR-${String(index+1).padStart(3,'0')}`));
export const SCANNER_ACTIONS=Object.freeze(['check_out','check_in','out_of_service','return_to_service','update_location']);
const rolePattern=/^[a-z][a-z0-9_]{1,39}$/;
const uidPattern=/^[-A-Za-z0-9_]{1,128}$/;
const clean=value=>String(value??'').trim();

export function assignedRoleIds(profile){
  const primary=profile?.roleId;
  if(typeof primary!=='string'||!rolePattern.test(primary))return [];
  const roles=[primary];
  for(let index=1;index<5;index++){
    const id=profile?.roleIds?.[index];
    if(typeof id==='string'&&rolePattern.test(id)&&id!=='master'&&!roles.includes(id))roles.push(id);
  }
  return roles;
}

export function roleSlots(roleIds,primary){
  if(!Array.isArray(roleIds))throw Error('Choose the account roles.');
  const selected=roleIds.filter(id=>id!=='');
  if(primary!==undefined)selected.unshift(primary);
  if(!selected.length||selected.some(id=>typeof id!=='string'||!rolePattern.test(id)))throw Error('Choose an existing primary role and valid additional roles.');
  const unique=[...new Set(selected)];
  if(unique.length>5)throw Error('Choose at most five roles for one account.');
  if(unique.slice(1).includes('master'))throw Error('Master cannot be added as an additional role.');
  return [...unique,...Array(5-unique.length).fill('')];
}

export function scannerNoticeId(scannerId,checkedOutAt){
  if(!SCANNER_IDS.includes(scannerId)||!Number.isSafeInteger(checkedOutAt)||checkedOutAt<=0)throw Error('Choose a valid scanner checkout.');
  return `scanner_overdue_${scannerId}_${checkedOutAt}`;
}

function bounded(value,label,max,required=false){
  const result=clean(value);
  if(result.length>max||(required&&!result))throw Error(`${label}${required?' is required and':''} must contain ${required?'1–':'at most '}${max} characters.`);
  return result;
}

export function buildScannerUpdate(payload={},context={}){
  const scannerId=String(payload.scannerId||''),action=payload.action;
  const {before=null,person,label,eventId,timestamp,canUse=false,canManage=false}=context;
  if(!SCANNER_IDS.includes(scannerId))throw Error('Choose a scanner from SCNR-001 through SCNR-020.');
  if(!SCANNER_ACTIONS.includes(action))throw Error('Choose a valid scanner action.');
  if(!person?.active||!uidPattern.test(person?.uid||''))throw Error('An active signed-in account is required.');
  if(action==='return_to_service'?!canManage:!canUse)throw Error('Your assigned roles cannot perform this scanner action.');
  const revision=before?.revision??0;
  if(!Number.isInteger(revision)||revision<0||!Number.isInteger(payload.expectedRevision)||payload.expectedRevision!==revision)throw Error('This scanner changed while you were editing. Review the latest status and try again.');
  if(before?.scannerId&&before.scannerId!==scannerId)throw Error('The scanner record does not match this device.');
  if(!uidPattern.test(eventId||''))throw Error('A fresh scanner audit identifier is required.');
  if(!(Number.isFinite(timestamp)&&timestamp>0)&&!(timestamp&&typeof timestamp==='object'&&timestamp['.sv']==='timestamp'&&Object.keys(timestamp).length===1))throw Error('A server timestamp is required.');
  const actorName=bounded(person.displayName,'Display name',48,true),actorRole=bounded(person.roleName,'Primary role',40,true);
  const scannerLabel=bounded(label??scannerId,'Scanner label',40,true),location=bounded(payload.location,'Location',80,true),note=bounded(payload.note,'Note',500);
  const old={checkoutStatus:before?.checkoutStatus||'unconfirmed',condition:before?.condition||'unconfirmed',holderUid:before?.holderUid||'',holderName:before?.holderName||'',holderRole:before?.holderRole||'',checkedOutAt:before?.checkedOutAt||0,lastHolderUid:before?.lastHolderUid||'',lastHolderName:before?.lastHolderName||'',lastCustodyAction:before?.lastCustodyAction||'',lastCustodyAt:before?.lastCustodyAt||0,location:before?.location||'',outOfServiceReason:before?.outOfServiceReason||''};
  const current={scannerId,checkoutStatus:old.checkoutStatus,condition:old.condition,holderUid:old.holderUid,holderName:old.holderName,holderRole:old.holderRole,checkedOutAt:old.checkedOutAt,lastHolderUid:old.lastHolderUid,lastHolderName:old.lastHolderName,lastCustodyAction:old.lastCustodyAction,lastCustodyAt:old.lastCustodyAt,location,outOfServiceReason:old.outOfServiceReason,revision:revision+1,updatedAt:timestamp,updatedBy:person.uid,updatedByName:actorName,updatedByRole:actorRole,auditId:eventId,lastAction:action};

  if(action==='check_out'){
    if(old.checkoutStatus!=='checked_in'||old.condition!=='good')throw Error('This scanner must be checked in and in good condition before checkout.');
    Object.assign(current,{checkoutStatus:'checked_out',condition:'good',holderUid:person.uid,holderName:actorName,holderRole:actorRole,checkedOutAt:timestamp,lastHolderUid:person.uid,lastHolderName:actorName,lastCustodyAction:'check_out',lastCustodyAt:timestamp,outOfServiceReason:''});
  }else if(action==='check_in'){
    if(!['unconfirmed','checked_out'].includes(old.checkoutStatus))throw Error('This scanner is already checked in.');
    if(old.checkoutStatus==='checked_out'&&old.holderUid!==person.uid&&!canManage)throw Error('Only the current holder or a scanner manager can check in this scanner.');
    const condition=payload.condition??(old.condition==='out_of_service'?'out_of_service':'good');
    if(!['good','out_of_service'].includes(condition))throw Error('Choose Good or Out of service for the scanner condition.');
    if(old.condition==='out_of_service'&&condition==='good'&&!canManage)throw Error('A scanner manager must confirm the repair before returning this scanner to good condition.');
    const reason=condition==='out_of_service'?bounded(payload.reason??old.outOfServiceReason,'Out-of-service reason',500,true):'';
    Object.assign(current,{checkoutStatus:'checked_in',condition,holderUid:'',holderName:'',holderRole:'',checkedOutAt:0,lastHolderUid:old.holderUid||old.lastHolderUid,lastHolderName:old.holderName||old.lastHolderName,lastCustodyAction:'check_in',lastCustodyAt:timestamp,outOfServiceReason:reason});
  }else if(action==='out_of_service'){
    current.condition='out_of_service';current.outOfServiceReason=bounded(payload.reason,'Out-of-service reason',500,true);
  }else if(action==='return_to_service'){
    if(old.condition!=='out_of_service')throw Error('This scanner is not marked out of service.');
    if(!note)throw Error('Enter the repair or return-to-service note.');
    current.condition='good';current.outOfServiceReason='';
  }else if(action==='update_location'){
    if(!before)throw Error('Confirm this scanner with a check-in or service report first.');
    if(old.checkoutStatus==='checked_out'&&old.holderUid!==person.uid&&!canManage)throw Error('Only the current holder or a scanner manager can move a checked-out scanner.');
    if(location===old.location)throw Error('Enter a different scanner location.');
  }
  const event={...current,id:eventId,scannerLabel,createdAt:timestamp,actorUid:person.uid,actorName,actorRole,action,note,previousCheckoutStatus:old.checkoutStatus,previousCondition:old.condition,previousLocation:old.location,previousHolderUid:old.holderUid,previousHolderName:old.holderName};
  return {current,event};
}
