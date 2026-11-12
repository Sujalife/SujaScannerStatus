const STATUS_KEYS=['no_trailer','empty','loading','ready'];
const MESSAGE_KEYS=['teamMessages','roleMessages','directMessages'];
export const DEFAULT_NOTIFICATION_PREFERENCES=Object.freeze({statuses:Object.freeze(Object.fromEntries(STATUS_KEYS.map(key=>[key,true]))),teamMessages:true,roleMessages:true,directMessages:true});

export function normalizeNotificationPreferences(value){
  const boolean=(entry,fallback=true)=>typeof entry==='boolean'?entry:fallback;
  return {statuses:Object.fromEntries(STATUS_KEYS.map(key=>[key,boolean(value?.statuses?.[key])])),...Object.fromEntries(MESSAGE_KEYS.map(key=>[key,boolean(value?.[key])]))};
}

export function validNotificationPreferences(value){
  const exactKeys=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===keys.length&&keys.every(key=>Object.hasOwn(object,key));
  return !!(exactKeys(value,['statuses',...MESSAGE_KEYS])&&exactKeys(value.statuses,STATUS_KEYS)&&STATUS_KEYS.every(key=>typeof value.statuses[key]==='boolean')&&MESSAGE_KEYS.every(key=>typeof value[key]==='boolean'));
}

export function messageIsEnabled(message,preferences){
  if(message.system&&message.dockId)return preferences.statuses[message.dockStatus]!==false;
  const key={team:'teamMessages',role:'roleMessages',user:'directMessages'}[message.audienceType];
  return !key||preferences[key]!==false;
}
