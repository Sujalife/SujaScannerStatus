/* Shared by Suja Life Tools and Suja Dock Status. No passphrase is persisted here. */
import {normalizeNotificationPreferences,validNotificationPreferences,messageIsEnabled} from './notification-preferences.js';
import {SCANNER_IDS,buildScannerUpdate,assignedRoleIds,roleSlots} from './scanner-domain.js';
const TTL=72*60*60*1000;
const DOCKS=['16','17','18','19'];
const ALL_PERMISSIONS=['dock.update','message.send','scanner.use','scanner.manage','users.manage','roles.manage'];
const ROLES={
  master:{id:'master',name:'Master',permissions:ALL_PERMISSIONS},
  supervisor:{id:'supervisor',name:'Supervisor',permissions:['dock.update','message.send','scanner.use','scanner.manage']},
  lead:{id:'lead',name:'Lead',permissions:['dock.update','message.send','scanner.use','scanner.manage']},
  manager:{id:'manager',name:'Manager',permissions:['dock.update','message.send','scanner.use','scanner.manage']},
  operator:{id:'operator',name:'Operator',permissions:['scanner.use']},
  forklift_driver:{id:'forklift_driver',name:'Forklift Driver',permissions:['dock.update','message.send','scanner.use']},
  netsuite_operator:{id:'netsuite_operator',name:'NetSuite Operator',permissions:['dock.update','message.send','scanner.use']},
  viewer:{id:'viewer',name:'Viewer',permissions:[]}
};
const PERMISSION_FIELDS={dockUpdate:'dock.update',messageSend:'message.send',scannerUse:'scanner.use',scannerManage:'scanner.manage'};
const fallbackRoles=()=>Object.fromEntries(Object.entries(ROLES).map(([id,role])=>[id,{...role,permissions:role.permissions.filter(permission=>!permission.startsWith('scanner.'))}]));
const messageWindow=(messages,now)=>(messages||[]).filter(message=>Number.isFinite(message.createdAt)&&message.createdAt<=now&&(message.persistent||message.createdAt>now-TTL)).sort((a,b)=>b.createdAt-a.createdAt);

const clone=value=>structuredClone(value);
// Unique names isolate temporary provisioning apps; these IDs are not credentials.
const provisionId=()=>typeof globalThis.crypto?.randomUUID==='function'?globalThis.crypto.randomUUID():`local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
const nameOf=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');
const cutoffEvents=(events,now=Date.now())=>(Array.isArray(events)?events:Object.values(events||{})).filter(e=>e.createdAt>now-TTL&&e.createdAt<=now).sort((a,b)=>b.createdAt-a.createdAt);
function validateName(value){const name=nameOf(value);if(name.length<2||name.length>48||/[\u0000-\u001f\u007f]/.test(name))throw Error('Display names must contain 2–48 characters.');return name;}
export async function displayNameLoginAddress(displayName) {
  const normalized=validateName(displayName).toLowerCase();
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
  return `${[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')}@users.suja-life-tools.invalid`;
}
export function hasPermission(user,permission){return !!user?.active&&(user.roleId==='master'||user.permissions?.includes(permission));}
export async function createPlatform(config={},options={}) {
  // Retire only obsolete sample-workspace state. Preserve Auth and user preferences.
  try {
    globalThis.localStorage?.removeItem('sujaToolsExploreDemo');
    globalThis.localStorage?.removeItem('suja-life-tools.demo.v1');
  } catch {}
  const listeners=new Set();
  let clockOffset=0;
  const state={mode:'setup',connected:false,user:null,account:null,docks:{},history:{},messages:[],users:{},roles:fallbackRoles(),scannerInventory:{},scanners:{},scannerHistory:{},scannerSetupRequired:false,now:Date.now(),notificationPreferences:normalizeNotificationPreferences(),notificationPreferencesSync:'loading',error:null};
  const emit=()=>{state.now=Date.now()+clockOffset;state.messages=messageWindow(state.messages,state.now);for(const id of DOCKS)state.history[id]=cutoffEvents(state.history[id],Date.now()+clockOffset);for(const listener of listeners)listener(clone(state));};
  const api={subscribe(listener){listeners.add(listener);listener(clone(state));return()=>listeners.delete(listener);},getSnapshot:()=>clone(state)};
  let retentionMaintenance=null;const ticker=setInterval(()=>{retentionMaintenance?.();emit();},30000);api.destroy=()=>{clearInterval(ticker);listeners.clear();};
  if(!config?.apiKey||!config?.projectId||!config?.appId){
    const unavailable=async()=>{throw Error('Live accounts are awaiting Firebase setup.');};
    for(const method of ['login','createAccount','updateDock','sendMessage','createUser','saveRole','assignRole','markRead','getDockHistory','saveNotificationPreferences','updateScanner','configureScanner','getScannerHistory','installScannerRoles'])api[method]=unavailable;
    api.logout=async()=>{};emit();return api;
  }
  state.mode='live';
  const NAMESPACE='toolsV2',sdkVersion=config.sdkVersion||'12.0.0';
  let appModule,authModule,dbModule,app,auth,db;
  try {
    const modules=options.sdk||{};
    [appModule,authModule,dbModule]=await Promise.all([
      modules.app||import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-app.js`),
      modules.auth||import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-auth.js`),
      modules.database||import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-database.js`)
    ]);
    app=appModule.getApps().find(a=>a.name==='suja-life-tools')||appModule.initializeApp(config,'suja-life-tools');
    auth=authModule.getAuth(app);db=dbModule.getDatabase(app);
    await authModule.setPersistence(auth,authModule.browserLocalPersistence);
  } catch {
    state.error='Firebase sign-in could not load. Check your connection and reload the page.';
    const unavailable=async()=>{throw Error(state.error);};
    for(const method of ['login','createAccount','updateDock','sendMessage','createUser','saveRole','assignRole','markRead','getDockHistory','saveNotificationPreferences','updateScanner','configureScanner','getScannerHistory','installScannerRoles'])api[method]=unavailable;
    api.logout=async()=>{};emit();return api;
  }
  let baseSubscriptions=[],activeSubscriptions=[],roleMessageOff=new Map(),generation=0,currentAuthUser=null,profile=null,pinnedMaster=null,pinLoaded=false,profileLoaded=false,pendingLoginName=null,bootstrapping=false,creatingAccount=false,serverOffset=0,activeEpoch=0,activeStarted=false,roleChannel='',lastCleanup=0;
  let rawHistory={},rawMessages={team:{},role:{},user:{}},receipts={};
  let preferenceDirtyUid=null,preferenceSaveSequence=0;
  const preferenceCacheKey=uid=>`sujaTools.alertPreferences.${uid}`;
  function readPreferenceCache(uid){try{const value=JSON.parse(globalThis.localStorage?.getItem(preferenceCacheKey(uid))||'null');return validNotificationPreferences(value?.preferences)?value:null;}catch{return null;}}
  function cachePreferences(uid,preferences,needsSync){try{globalThis.localStorage?.setItem(preferenceCacheKey(uid),JSON.stringify({preferences,needsSync}));}catch{}}
  const serverNow=()=>Date.now()+serverOffset;
  const pathRef=path=>dbModule.ref(db,path?`${NAMESPACE}/${path}`:NAMESPACE);
  const permissionDenied=error=>/permission|denied/i.test(`${error?.code||''} ${error?.message||''}`);
  function friendlyError(error,fallback='The update could not be saved. Please try again.') {
    if(permissionDenied(error))return 'Your access or the workspace rules changed. Refresh and try again, or contact your master administrator.';
    if(/network|disconnected|unavailable/i.test(`${error?.code||''} ${error?.message||''}`))return 'The workspace could not connect. Check your connection and try again.';
    return error?.message||fallback;
  }
  function authError(error) {
    if(['auth/operation-not-allowed','auth/configuration-not-found'].includes(error?.code))return 'Sign-in has not been enabled for this workspace. Contact your master administrator.';
    if(error?.code==='auth/network-request-failed')return 'Sign-in could not connect. Check your connection and try again.';
    if(['auth/invalid-api-key','auth/app-not-authorized','auth/unauthorized-domain'].includes(error?.code))return 'This workspace’s sign-in configuration needs attention. Contact your master administrator.';
    if(error?.code==='auth/too-many-requests')return 'Too many sign-in attempts. Please wait a moment and try again.';
    if(error?.code==='auth/email-already-in-use')return 'That display name already has an account. Sign in or choose another display name.';
    if(error?.code==='auth/weak-password')return 'Use a passphrase with at least 8 characters.';
    return 'Display name or passphrase did not match an active account.';
  }
  function fromRole(value,id) {
    const map=value?.permissions||{};
    return {id:value?.id||id,name:value?.name||id,permissions:Array.isArray(map)?map:Object.entries(PERMISSION_FIELDS).filter(([field])=>map[field]===true).map(([,permission])=>permission)};
  }
  const toRole=role=>({id:role.id,name:role.name,permissions:Object.fromEntries(Object.entries(PERMISSION_FIELDS).map(([field,permission])=>[field,role.permissions?.includes(permission)||false]))});
  function clearActive() {
    ++activeEpoch;
    preferenceDirtyUid=null;++preferenceSaveSequence;
    activeSubscriptions.forEach(off=>off());activeSubscriptions=[];for(const off of roleMessageOff.values())off();roleMessageOff.clear();roleChannel='';activeStarted=false;
    rawHistory={};rawMessages={team:{},role:{},user:{}};receipts={};
    Object.assign(state,{user:null,docks:{},history:{},messages:[],users:{},roles:fallbackRoles(),scannerInventory:{},scanners:{},scannerHistory:{},scannerSetupRequired:false,now:Date.now(),notificationPreferences:normalizeNotificationPreferences(),notificationPreferencesSync:'loading'});
  }
  function clearAll() {baseSubscriptions.forEach(off=>off());baseSubscriptions=[];clearActive();profile=null;profileLoaded=false;provisioningPending=false;lastCleanup=0;pinLoaded=false;pinnedMaster=null;bootstrapping=false;state.account=null;state.connected=false;state.error=null;}
  function refreshIdentity() {
    if(!currentAuthUser){state.account=null;state.user=null;return;}
    const displayName=profile?.displayName||currentAuthUser.displayName||pendingLoginName||'Your account';
    state.account={uid:currentAuthUser.uid,displayName,roleId:profile?.roleId||'viewer',active:!!profile?.active,needsMasterSetup:!pinnedMaster,isConfiguredMaster:pinnedMaster===currentAuthUser.uid};
    const allowed=!!profile?.active&&(profile.roleId!=='master'||pinnedMaster===currentAuthUser.uid);
    if(!allowed){state.user=null;return;}
    const ids=assignedRoleIds(profile),role=state.roles[profile.roleId];
    state.user={...profile,uid:currentAuthUser.uid,roleIds:ids,roleNames:ids.map(id=>state.roles[id]?.name||id),roleName:role?.name||profile.roleId,permissions:profile.roleId==='master'?[...ALL_PERMISSIONS]:[...new Set(ids.flatMap(id=>state.roles[id]?.permissions||[]))]};
  }
  function rebuildMessages() {
    const now=serverNow(),all=new Map();
    for(const channel of [rawMessages.team,rawMessages.user,...Object.values(rawMessages.role)])for(const value of Object.values(channel||{}))if(value?.id)all.set(value.id,value);
    const labels={no_trailer:'No trailer',empty:'Empty trailer',loading:'Loading',ready:'Locked · ready for pickup'};
    for(const id of DOCKS){
      state.history[id]=cutoffEvents(rawHistory[id],now);
      for(const event of state.history[id])all.set(`dock_${id}_${event.id}`,{id:`dock_${id}_${event.id}`,body:`Dock ${id}: ${labels[event.status]||event.status}${event.trailerId?` · Trailer ${event.trailerId}`:''}${event.note?` — ${event.note}`:''}`,senderUid:event.actorUid,senderName:event.actorName,senderRole:event.actorRole,createdAt:event.createdAt,system:true,dockId:id,dockStatus:event.status,audienceType:'team',audienceId:'team'});
    }
    if(state.user?.uid===pinnedMaster){
      for(const person of Object.values(state.users))if(person.active===false&&person.approvalState!=='approved'&&(person.approvalState==='pending'||person.roleId==='viewer')){
        const id=`pending_${person.uid}`;
        all.set(id,{id,noticeType:'pending_account',accountUid:person.uid,body:`${person.displayName} is waiting for account approval. Assign the roles they need in Team.`,senderName:'Account requests',createdAt:Number(person.createdAt)||now,system:true,persistent:true,audienceType:'user',audienceId:pinnedMaster});
      }
    }
    if(state.user&&(state.user.uid===pinnedMaster||state.user.roleIds.some(id=>['lead','supervisor','manager'].includes(id)))){
      for(const [scannerId,current] of Object.entries(state.scanners))if(current.checkoutStatus==='checked_out'&&Number.isFinite(current.checkedOutAt)&&current.checkedOutAt>0&&now-current.checkedOutAt>12*60*60*1000){
        const id=`scanner_overdue_${scannerId}_${current.checkedOutAt}`,label=state.scannerInventory[scannerId]?.label||scannerId;
        all.set(id,{id,noticeType:'scanner_overdue',scannerId,body:`${label} has been checked out by ${current.holderName} for ${Math.floor((now-current.checkedOutAt)/3600000)} hours. Location: ${current.location}. Please follow up and arrange its return.`,senderName:'Scanner Status',createdAt:current.checkedOutAt+12*60*60*1000,system:true,persistent:true,audienceType:'system',audienceId:'scanner_leadership'});
      }
    }
    state.messages=messageWindow([...all.values()],now).filter(message=>message.persistent||messageIsEnabled(message,state.notificationPreferences)).map(message=>({...message,read:!!receipts[message.id]}));
  }
  function watch(path,callback,bucket=baseSubscriptions,{optional=false,onError}={}) {
    const token=generation,epoch=activeEpoch,isActive=bucket===activeSubscriptions;
    const ref=path.startsWith('.info/')?dbModule.ref(db,path):pathRef(path);
    const off=dbModule.onValue(ref,snapshot=>{if(token===generation&&(!isActive||epoch===activeEpoch))callback(snapshot.val());},error=>{
      if(token!==generation||(isActive&&epoch!==activeEpoch))return;
      if(!optional)state.error=permissionDenied(error)&&!state.user?'Publish the version 2 database rules to finish workspace setup.':friendlyError(error);
      onError?.(error);
      if(path==='config/masterUid'){pinLoaded=true;pinnedMaster=null;refreshIdentity();}
      emit();
    });bucket.push(off);return off;
  }
  async function bootstrapIfPinned() {
    if(!currentAuthUser||!pinLoaded||!profileLoaded||pinnedMaster!==currentAuthUser.uid||bootstrapping||(profile?.roleId==='master'&&profile?.active))return;
    const token=generation,person=currentAuthUser;bootstrapping=true;
    try {
      const displayName=validateName(profile?.displayName||person.displayName||pendingLoginName);
      const next={uid:person.uid,displayName,roleId:'master',active:true,approvalState:'approved',createdAt:profile?.createdAt||dbModule.serverTimestamp()};
      const changes={[`profiles/${person.uid}`]:next,[`directory/${person.uid}`]:next};
      const existingRoles=(await dbModule.get(pathRef('roles'))).val()||{};
      for(const [id,role] of Object.entries(ROLES))if(!existingRoles[id])changes[`roles/${id}`]=toRole(role);
      await dbModule.update(pathRef(''),changes);
      if(token!==generation)return;
      const saved=await dbModule.get(pathRef(`profiles/${person.uid}`));if(token!==generation)return;profile=saved.val();state.error=null;refreshIdentity();startActive();emit();
    } catch(error){if(token===generation){state.error=permissionDenied(error)?'Publish the version 2 database rules to finish workspace setup.':friendlyError(error);refreshIdentity();emit();}}
    finally{if(token===generation)bootstrapping=false;}
  }
  let provisioningPending=false;
  async function ensurePendingProfile() {
    if(creatingAccount||provisioningPending||bootstrapping||!currentAuthUser||!profileLoaded||!pinLoaded||profile||pinnedMaster===currentAuthUser.uid)return;
    const name=currentAuthUser.displayName||pendingLoginName;if(!name)return;
    const token=generation;provisioningPending=true;
    try {
      const next={uid:currentAuthUser.uid,displayName:validateName(name),roleId:'viewer',active:false,approvalState:'pending',createdAt:dbModule.serverTimestamp()};
      await dbModule.update(pathRef(''),{[`profiles/${next.uid}`]:next,[`directory/${next.uid}`]:next});
      const saved=await dbModule.get(pathRef(`profiles/${next.uid}`));if(token===generation){profile=saved.val();state.error=null;refreshIdentity();emit();}
    }catch(error){if(token===generation){state.error=permissionDenied(error)?'Publish the version 2 database rules to finish workspace setup.':friendlyError(error);emit();}}
    finally{if(token===generation)provisioningPending=false;}
  }
  function switchRoleChannels(roleIds) {
    const desired=new Set(roleIds||[]),channel=[...desired].sort().join(',');
    if(roleChannel===channel)return;
    roleChannel=channel;
    for(const [id,off] of roleMessageOff)if(!desired.has(id)){off();roleMessageOff.delete(id);delete rawMessages.role[id];}
    const token=generation,epoch=activeEpoch;
    for(const roleId of desired)if(!roleMessageOff.has(roleId)){
      // Reserve the channel before registering; fake and cached SDK callbacks may run promptly.
      roleMessageOff.set(roleId,()=>{});
      const off=dbModule.onValue(pathRef(`messages/roles/${roleId}`),snapshot=>{if(token!==generation||epoch!==activeEpoch||!roleMessageOff.has(roleId))return;rawMessages.role[roleId]=snapshot.val()||{};rebuildMessages();emit();},error=>{if(token!==generation||epoch!==activeEpoch||!roleMessageOff.has(roleId))return;state.error=friendlyError(error);emit();});
      roleMessageOff.set(roleId,off);
    }
    rebuildMessages();emit();
  }
  function startActive() {
    refreshIdentity();
    if(!state.user){if(activeStarted)clearActive();refreshIdentity();return;}
    if(activeStarted){switchRoleChannels(state.user.roleIds);return;}
    activeStarted=true;const person=currentAuthUser;
    const cachedPreferences=readPreferenceCache(person.uid);let preferencesLoaded=false;
    preferenceDirtyUid=cachedPreferences?.needsSync?person.uid:null;
    state.notificationPreferences=normalizeNotificationPreferences(cachedPreferences?.preferences);
    state.notificationPreferencesSync='loading';
    watch(`notificationPreferences/${person.uid}`,value=>{
      if(!preferencesLoaded&&cachedPreferences?.needsSync){
        preferencesLoaded=true;state.notificationPreferences=normalizeNotificationPreferences(cachedPreferences.preferences);state.notificationPreferencesSync='device';rebuildMessages();emit();
        if(state.connected)void api.saveNotificationPreferences(state.notificationPreferences);
        return;
      }
      // Local SDK echoes and rejected-write rollbacks cannot replace device choices.
      if(preferenceDirtyUid===person.uid)return;
      preferencesLoaded=true;state.notificationPreferences=normalizeNotificationPreferences(value);state.notificationPreferencesSync='synced';cachePreferences(person.uid,state.notificationPreferences,false);rebuildMessages();emit();
    },activeSubscriptions,{optional:true,onError:()=>{preferencesLoaded=true;state.notificationPreferencesSync='device';rebuildMessages();}});
    watch('roles',value=>{state.roles=Object.fromEntries(Object.entries(value||{}).map(([id,role])=>[id,fromRole(role,id)]));refreshIdentity();switchRoleChannels(state.user?.roleIds||[]);rebuildMessages();emit();},activeSubscriptions);
    watch('directory',value=>{state.users=value||{};rebuildMessages();emit();},activeSubscriptions);
    for(const id of DOCKS){
      watch(`docks/${id}/current`,value=>{if(value)state.docks[id]=value;else delete state.docks[id];emit();},activeSubscriptions);
      watch(`docks/${id}/history`,value=>{rawHistory[id]=value||{};rebuildMessages();emit();},activeSubscriptions);
    }
    const scannerReadError=()=>{state.scannerSetupRequired=true;};
    watch('scannerInventory',value=>{state.scannerInventory=value||{};rebuildMessages();emit();},activeSubscriptions,{optional:true,onError:scannerReadError});
    for(const scannerId of SCANNER_IDS){
      watch(`scanners/${scannerId}/current`,value=>{if(value)state.scanners[scannerId]=value;else delete state.scanners[scannerId];rebuildMessages();emit();},activeSubscriptions,{optional:true,onError:scannerReadError});
      watch(`scanners/${scannerId}/history`,value=>{state.scannerHistory[scannerId]=Object.values(value||{}).sort((a,b)=>b.createdAt-a.createdAt);emit();},activeSubscriptions,{optional:true,onError:scannerReadError});
    }
    watch('messages/team',value=>{rawMessages.team=value||{};rebuildMessages();emit();},activeSubscriptions);
    watch(`messages/users/${person.uid}`,value=>{rawMessages.user=value||{};rebuildMessages();emit();},activeSubscriptions);
    watch(`readReceipts/${person.uid}`,value=>{receipts=value||{};rebuildMessages();emit();},activeSubscriptions);
    switchRoleChannels(state.user.roleIds);
  }
  async function purgeExpired() {
    if(!state.user||!state.connected||serverNow()-lastCleanup<60000)return;
    lastCleanup=serverNow();const cutoff=serverNow()-TTL,changes={};
    for(const id of DOCKS)for(const [key,event] of Object.entries(rawHistory[id]||{}))if(Number.isFinite(event?.createdAt)&&event.createdAt<=cutoff)changes[`docks/${id}/history/${key}`]=null;
    const channels=[['messages/team',rawMessages.team],[`messages/users/${state.user.uid}`,rawMessages.user],...Object.entries(rawMessages.role).map(([id,values])=>[`messages/roles/${id}`,values])];
    for(const [path,values] of channels)for(const [key,message] of Object.entries(values||{}))if(Number.isFinite(message?.createdAt)&&message.createdAt<=cutoff)changes[`${path}/${key}`]=null;
    const outstanding=new Set(state.messages.filter(message=>message.persistent).map(message=>message.id));
    for(const [key,receipt] of Object.entries(receipts))if(!outstanding.has(key)&&Number.isFinite(receipt?.createdAt)&&receipt.createdAt<=cutoff)changes[`readReceipts/${state.user.uid}/${key}`]=null;
    if(!Object.keys(changes).length)return;
    try{await dbModule.update(pathRef(''),changes);}catch{/* Later authorized open clients may retry retention cleanup. */}
  }
  retentionMaintenance=()=>{rebuildMessages();void purgeExpired();};
  const stopAuth=authModule.onAuthStateChanged(auth,user=>{
    ++generation;clearAll();currentAuthUser=user;
    if(!user){emit();return;}
    if(user.isAnonymous){currentAuthUser=null;state.error='Use a display name and passphrase to sign in to this workspace.';emit();void authModule.signOut(auth);return;}
    refreshIdentity();emit();
    watch('.info/connected',value=>{state.connected=!!value;emit();});
    watch('.info/serverTimeOffset',value=>{serverOffset=Number(value)||0;clockOffset=serverOffset;rebuildMessages();emit();},baseSubscriptions,{optional:true});
    watch(`profiles/${user.uid}`,value=>{profileLoaded=true;profile=value||null;refreshIdentity();startActive();state.error=null;emit();void bootstrapIfPinned();void ensurePendingProfile();});
    watch('config/masterUid',value=>{pinnedMaster=typeof value==='string'&&value?value:null;pinLoaded=true;refreshIdentity();startActive();emit();void bootstrapIfPinned();void ensurePendingProfile();});
  });
  const requireActive=()=>{if(!state.user)throw Error('Your account is waiting for activation by the Master.');return state.user;};
  const requirePermission=permission=>{const person=requireActive();if(!hasPermission(person,permission))throw Error('Your assigned role cannot perform this action.');return person;};
  const requireMaster=()=>{const person=requireActive();if(person.roleId!=='master'||person.uid!==pinnedMaster)throw Error('Only the Master can manage accounts and roles.');return person;};
  function validatePassphrase(passphrase){if(typeof passphrase!=='string'||passphrase.length<8||passphrase.length>128)throw Error('Use a passphrase with 8–128 characters.');}
  async function waitForAccount(uid) {
    const ready=snapshot=>snapshot.account?.uid===uid&&(snapshot.user||(profileLoaded&&pinLoaded)||snapshot.error);
    if(ready(state))return clone(state.user||state.account);
    return new Promise((resolve,reject)=>{
      let off=null,done=false;const timer=setTimeout(()=>finish(Error('Your account is still loading. Refresh the page and try again.')),15000);
      function finish(error,value){if(done)return;done=true;clearTimeout(timer);off?.();if(error)reject(error);else resolve(value);}
      off=api.subscribe(snapshot=>{if(ready(snapshot))finish(null,snapshot.user||snapshot.account);else if(snapshot.error)finish(Error(snapshot.error));});if(done)off();
    });
  }
  api.login=async(displayName,passphrase)=>{
    try{
      if(auth.currentUser&&!state.user)await api.logout();
      pendingLoginName=validateName(displayName);state.error=null;
      const credential=await authModule.signInWithEmailAndPassword(auth,await displayNameLoginAddress(displayName),passphrase);
      return await waitForAccount(credential.user.uid);
    }catch(error){if(error?.code)throw Error(authError(error));throw error;}
  };
  api.logout=async()=>{++generation;clearAll();currentAuthUser=null;emit();await authModule.signOut(auth);};
  api.createAccount=async(displayName,passphrase)=>{
    const name=validateName(displayName);validatePassphrase(passphrase);
    if(auth.currentUser)throw Error('Sign out before creating a different account.');
    pendingLoginName=name;creatingAccount=true;let created=null;
    try {
      const credential=await authModule.createUserWithEmailAndPassword(auth,await displayNameLoginAddress(name),passphrase);created=credential.user;
      await authModule.updateProfile(created,{displayName:name});
      const next={uid:created.uid,displayName:name,roleId:'viewer',active:false,approvalState:'pending',createdAt:dbModule.serverTimestamp()};
      await dbModule.update(pathRef(''),{[`profiles/${created.uid}`]:next,[`directory/${created.uid}`]:next});
      const saved=await dbModule.get(pathRef(`profiles/${created.uid}`));profileLoaded=true;profile=saved.val();refreshIdentity();emit();void bootstrapIfPinned();
      return await waitForAccount(created.uid);
    } catch(error) {
      // Keep a genuine newly authenticated identity and its UID available when
      // rules have not yet been published. It still has no operational access.
      if(created){
        currentAuthUser=created;refreshIdentity();state.error=permissionDenied(error)?'Your account was created. Publish the version 2 database rules, then refresh to finish workspace setup.':friendlyError(error);emit();
        return clone(state.account);
      }
      if(error?.code?.startsWith('auth/'))throw Error(authError(error));
      throw Error(friendlyError(error));
    } finally {creatingAccount=false;}
  };
  function accountRoleFields(payload,existing=null){
    const primary=String(payload.roleId||'');
    if(!state.roles[primary]||primary==='master')throw Error('Choose an existing team role.');
    const fields={roleId:primary};
    if(payload.roleIds!==undefined||existing?.roleIds){
      const selected=payload.roleIds!==undefined?payload.roleIds:assignedRoleIds(existing).filter(id=>id!==existing.roleId);
      const slots=roleSlots(selected,primary);
      if(slots.some(id=>id&&(id==='master'||!state.roles[id])))throw Error('Choose existing non-Master team roles.');
      fields.roleIds=slots;
    }
    return fields;
  }
  api.createUser=async payload=>{
    requireMaster();const name=validateName(payload.displayName);validatePassphrase(payload.passphrase);
    const roles=accountRoleFields(payload);
    let secondaryApp=null,secondaryAuth=null,created=null;
    try {
      secondaryApp=appModule.initializeApp(config,`suja-tools-provision-${provisionId()}`);secondaryAuth=authModule.getAuth(secondaryApp);
      await authModule.setPersistence(secondaryAuth,authModule.inMemoryPersistence);
      const credential=await authModule.createUserWithEmailAndPassword(secondaryAuth,await displayNameLoginAddress(name),payload.passphrase);created=credential.user;
      await authModule.updateProfile(created,{displayName:name});
      const next={uid:created.uid,displayName:name,...roles,active:true,approvalState:'approved',createdAt:dbModule.serverTimestamp()};
      await dbModule.update(pathRef(''),{[`profiles/${created.uid}`]:next,[`directory/${created.uid}`]:next});
      return {...next,createdAt:serverNow()};
    } catch(error) {
      if(created){try{await authModule.deleteUser(created);}catch{};}
      if(error?.code?.startsWith('auth/'))throw Error(authError(error));
      throw Error(friendlyError(error));
    } finally {
      if(secondaryAuth){try{await authModule.signOut(secondaryAuth);}catch{}}
      if(secondaryApp){try{await appModule.deleteApp(secondaryApp);}catch{}}
    }
  };
  api.assignRole=async payload=>{
    const person=requireMaster();
    if(!payload?.uid||payload.uid===person.uid||payload.roleId==='master'||!state.roles[payload.roleId])throw Error('Choose an existing teammate and team role.');
    const existing=state.users[payload.uid];if(!existing)throw Error('Account not found.');
    const next={uid:existing.uid,displayName:existing.displayName,...accountRoleFields(payload,existing),active:payload.active===undefined?existing.active:!!payload.active,approvalState:'approved',createdAt:existing.createdAt};
    try{await dbModule.update(pathRef(''),{[`profiles/${next.uid}`]:next,[`directory/${next.uid}`]:next});return next;}catch(error){throw Error(friendlyError(error));}
  };
  api.saveRole=async payload=>{
    requireMaster();if(!/^[a-z][a-z0-9_]{1,39}$/.test(payload.id)||payload.id==='master')throw Error('Use a unique lowercase role ID. The Master role is protected.');
    const name=String(payload.name||'').trim();if(!name||name.length>40)throw Error('Enter a role name with at most 40 characters.');
    const permissions=[...new Set(payload.permissions||[])];if(permissions.some(permission=>!['dock.update','message.send','scanner.use','scanner.manage'].includes(permission)))throw Error('Account administration belongs to Master.');
    const role={id:payload.id,name,permissions};try{await dbModule.set(pathRef(`roles/${role.id}`),toRole(role));return role;}catch(error){throw Error(friendlyError(error));}
  };
  api.installScannerRoles=async()=>{
    requireMaster();if(!state.connected)throw Error('Connect to the workspace before updating role permissions.');
    const token=generation;
    try{
      // The role listener can still be loading. Read the authoritative values before
      // extending builtins so fallback labels or permissions cannot overwrite edits.
      const stored=(await dbModule.get(pathRef('roles'))).val()||{};
      if(token!==generation)throw Error('Your account changed. Reopen scanner role setup.');
      requireMaster();
      const changes={};
      for(const [id,builtin] of Object.entries(ROLES)){
        if(stored[id]){
          // Extend existing roles with permission leaves only. A concurrent rename
          // or dock/message permission edit must not be replaced by setup data.
          for(const [field,permission] of Object.entries(PERMISSION_FIELDS))if(permission.startsWith('scanner.')&&builtin.permissions.includes(permission))changes[`roles/${id}/permissions/${field}`]=true;
        }else{
          changes[`roles/${id}`]=toRole(builtin);
        }
      }
      await dbModule.update(pathRef(''),changes);return true;
    }catch(error){throw Error(`Scanner roles could not be updated. ${friendlyError(error)}`);}
  };
  api.configureScanner=async payload=>{
    const person=requireMaster();if(!state.connected)throw Error('Connect to the workspace before editing scanner details.');
    const scannerId=String(payload.scannerId||''),label=String(payload.label||'').trim(),homeLocation=String(payload.homeLocation||'').trim();
    if(!SCANNER_IDS.includes(scannerId))throw Error('Choose a scanner from SCNR-001 through SCNR-020.');
    if(!label||label.length>40||/[\u0000-\u001f\u007f]/.test(label))throw Error('Enter a scanner name or ID with 1–40 characters.');
    if(homeLocation.length>80)throw Error('Use at most 80 characters for the home location.');
    const normalized=label.normalize('NFKC').toLowerCase();
    if(SCANNER_IDS.some(id=>id!==scannerId&&(state.scannerInventory[id]?.label||id).normalize('NFKC').toLowerCase()===normalized))throw Error('That scanner name or ID is already in use.');
    const value={id:scannerId,label,homeLocation,updatedAt:dbModule.serverTimestamp(),updatedBy:person.uid};
    try{await dbModule.set(pathRef(`scannerInventory/${scannerId}`),value);return {...value,updatedAt:serverNow()};}catch(error){throw Error(friendlyError(error));}
  };
  api.updateScanner=async payload=>{
    const person=requireActive();if(!state.connected)throw Error('Connect to the workspace before saving a scanner action.');
    if(state.scannerSetupRequired)throw Error('Scanner access needs the updated database rules. Contact your Master administrator.');
    const scannerId=String(payload.scannerId||'');if(!SCANNER_IDS.includes(scannerId))throw Error('Choose a scanner from SCNR-001 through SCNR-020.');
    const eventId=dbModule.push(pathRef(`scanners/${scannerId}/history`)).key;
    const update=buildScannerUpdate(payload,{before:state.scanners[scannerId]||null,person,label:state.scannerInventory[scannerId]?.label||scannerId,eventId,timestamp:dbModule.serverTimestamp(),canUse:hasPermission(person,'scanner.use'),canManage:hasPermission(person,'scanner.manage')});
    try{await dbModule.update(pathRef(`scanners/${scannerId}`),{current:update.current,[`history/${eventId}`]:update.event});return clone(update);}
    catch(error){throw Error(permissionDenied(error)?'This scanner changed or your roles no longer allow this action. Review the latest status and try again.':friendlyError(error));}
  };
  api.getScannerHistory=async scannerId=>{
    requireActive();if(!SCANNER_IDS.includes(String(scannerId)))throw Error('Choose a valid scanner.');
    return clone(state.scannerHistory[String(scannerId)]||[]);
  };
  api.updateDock=async payload=>{
    const person=requirePermission('dock.update'),id=String(payload.dockId),before=state.docks[id];
    if(!DOCKS.includes(id)||!['no_trailer','empty','loading','ready'].includes(payload.status))throw Error('Choose a valid dock and status.');
    if(!Number.isInteger(payload.expectedRevision)||payload.expectedRevision!==(before?.revision||0))throw Error('This dock changed while you were editing. Review the latest status and try again.');
    const trailerId=payload.status==='no_trailer'?'':String(payload.trailerId||'').trim(),note=String(payload.note||'').trim();
    if(trailerId.length>40||note.length>500)throw Error('Trailer number or note is too long.');
    if(payload.status==='ready'&&payload.lockedConfirmed!==true)throw Error('Confirm the trailer is physically locked before marking it ready.');
    if(before?.status==='ready'&&payload.status==='loading'&&!note)throw Error('Explain why the locked trailer is being reopened.');
    if(before?.status===payload.status&&before?.trailerId===trailerId&&!note)throw Error('Choose a new status, trailer number, or add an update note.');
    const eventId=dbModule.push(pathRef(`docks/${id}/history`)).key,revision=(before?.revision||0)+1,timestamp=dbModule.serverTimestamp();
    const current={dockId:id,status:payload.status,trailerId,lockedConfirmed:payload.status==='ready',revision,updatedAt:timestamp,updatedBy:person.uid,updatedByName:person.displayName,updatedByRole:person.roleName,auditId:eventId};
    const event={id:eventId,dockId:id,fromStatus:before?.status||'unconfirmed',status:payload.status,trailerId,previousTrailerId:before?.trailerId||'',note,lockedConfirmed:payload.status==='ready',createdAt:timestamp,actorUid:person.uid,actorName:person.displayName,actorRole:person.roleName,revision};
    try{await dbModule.update(pathRef(`docks/${id}`),{current,[`history/${eventId}`]:event});return {current:{...current,updatedAt:serverNow()},event:{...event,createdAt:serverNow()}};}
    catch(error){throw Error(permissionDenied(error)?'This dock changed or your role no longer allows this update. Review the latest status and try again.':friendlyError(error));}
  };
  api.sendMessage=async payload=>{
    const person=requirePermission('message.send'),body=String(payload.body||'').trim(),audienceType=payload.audienceType||'team',audienceId=audienceType==='team'?'team':String(payload.audienceId||'');
    if(!body||body.length>1500)throw Error('Enter a message of 1–1,500 characters.');
    if(!['team','role','user'].includes(audienceType))throw Error('Choose a valid message audience.');
    if(audienceType==='role'&&!state.roles[audienceId])throw Error('Choose an existing role.');
    if(audienceType==='user'&&!state.users[audienceId]?.active)throw Error('Choose an active teammate.');
    const channel=audienceType==='team'?'team':`${audienceType==='role'?'roles':'users'}/${audienceId}`,ref=dbModule.push(pathRef(`messages/${channel}`));
    const message={id:ref.key,body,audienceType,audienceId,senderUid:person.uid,senderName:person.displayName,senderRole:person.roleName,createdAt:dbModule.serverTimestamp(),system:false};
    try{await dbModule.set(ref,message);return {...message,createdAt:serverNow()};}catch(error){throw Error(friendlyError(error));}
  };
  api.markRead=async id=>{
    const person=requireActive(),message=state.messages.find(item=>item.id===id);if(!message)throw Error('Message is no longer available.');
    try{await dbModule.set(pathRef(`readReceipts/${person.uid}/${id}`),{createdAt:message.createdAt,readAt:dbModule.serverTimestamp()});}catch(error){throw Error(friendlyError(error));}
  };
  api.saveNotificationPreferences=async preferences=>{
    const person=requireActive(),token=generation,epoch=activeEpoch;
    if(!validNotificationPreferences(preferences))throw Error('Choose an on or off setting for every alert and message type.');
    const next=normalizeNotificationPreferences(preferences),saveSequence=++preferenceSaveSequence;
    preferenceDirtyUid=person.uid;
    cachePreferences(person.uid,next,true);state.notificationPreferences=next;state.notificationPreferencesSync='device';rebuildMessages();emit();
    if(!state.connected)return {synced:false};
    try{
      await dbModule.set(pathRef(`notificationPreferences/${person.uid}`),next);
      if(token===generation&&epoch===activeEpoch&&saveSequence===preferenceSaveSequence){cachePreferences(person.uid,next,false);preferenceDirtyUid=null;state.notificationPreferences=next;state.notificationPreferencesSync='synced';rebuildMessages();emit();}
      return {synced:true};
    }catch{
      // A workspace with older rules can still use this account's device choices.
      return {synced:false};
    }
  };
  api.getDockHistory=async id=>{
    requireActive();if(!DOCKS.includes(String(id)))throw Error('Choose a valid dock.');return cutoffEvents(rawHistory[String(id)],serverNow());
  };
  const onPreferenceStorage=event=>{
    const uid=state.user?.uid;if(!uid||event.key!==preferenceCacheKey(uid))return;
    const cached=readPreferenceCache(uid);if(!cached)return;
    ++preferenceSaveSequence;preferenceDirtyUid=cached.needsSync?uid:null;state.notificationPreferences=normalizeNotificationPreferences(cached.preferences);state.notificationPreferencesSync=cached.needsSync?'device':'synced';rebuildMessages();emit();
  };
  globalThis.window?.addEventListener('storage',onPreferenceStorage);
  const oldDestroy=api.destroy;api.destroy=()=>{++generation;clearAll();currentAuthUser=null;globalThis.window?.removeEventListener('storage',onPreferenceStorage);oldDestroy();stopAuth();};emit();return api;
}
