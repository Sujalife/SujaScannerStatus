import {publicRoleName} from './profile-display.js';

const PERMISSIONS={
  'dock.update':'Update dock status',
  'message.send':'Send team messages',
  'scanner.use':'Check scanners in and out; report problems',
  'scanner.manage':'Restore scanners and return another person’s device'
};
const roleIdsOf=person=>[...new Set([person?.roleId,...Object.values(person?.roleIds||{})].filter(Boolean))];

export function createTeamUI({getState,getPlatform,escape,icon,toast,dialog,fitActionDialog}){
  const filters={search:'',status:'all',role:'all'};
  let currentDialog=null;
  const $=(selector,root=currentDialog)=>root?.querySelector(selector);
  const master=()=>getState().user?.roleId==='master';
  const roleLabel=(id,state=getState())=>publicRoleName(id,state.roles?.[id]?.name||id);
  const rolesFor=person=>roleIdsOf(person).map(id=>roleLabel(id));
  const editableRoles=()=>Object.values(getState().roles||{}).filter(role=>role.id!=='master').sort((a,b)=>a.name.localeCompare(b.name));
  const registrationTime=value=>value?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))+' PT':'Time unavailable';
  const waiting=person=>person.active===false&&(person.approvalState==='pending'||(!person.approvalState&&person.roleId==='viewer'));
  const badges=person=>roleIdsOf(person).map(id=>`<span class="team-role-badge">${escape(roleLabel(id))}</span>`).join('');
  const tabs=(selected,state=getState())=>{
    const count=Object.values(state.users||{}).filter(waiting).length;
    return `<div class="tabs team-tabs"><button type="button" data-team-tab="people" class="${selected==='people'?'active':''}">People</button>${master()?`<button type="button" data-team-tab="pending" class="${selected==='pending'?'active':''}">Awaiting access${count?` <span class="team-tab-count">${count}</span>`:''}</button><button type="button" data-team-tab="add" class="${selected==='add'?'active':''}">Add person</button><button type="button" data-team-tab="roles" class="${selected==='roles'?'active':''}">Roles</button>`:''}</div>`;
  };
  function show(title,body,action=false){
    const personUid=getState().user?.uid;
    const d=dialog(title,body,true);currentDialog=d;
    if(action)fitActionDialog(d,'team-action-dialog');
    else{d.classList.add('team-directory-dialog');fitActionDialog(d,'team-directory-dialog');}
    d.querySelectorAll('[data-team-tab]').forEach(button=>button.onclick=()=>open(button.dataset.teamTab));
    const off=getPlatform().subscribe(state=>{
      if(!d.isConnected)return;
      if(state.user?.uid!==personUid){d.close();return;}
      const form=d.querySelector('.team-action-form');
      if(form){const save=form.querySelector('button[type="submit"]');if(save)save.disabled=!state.connected||form.dataset.busy==='true';}
      if(d.dataset.teamTab==='people'||d.dataset.teamTab==='pending')refreshDirectory(d.dataset.teamTab,d);
    });
    d.addEventListener('close',()=>{off();if(currentDialog===d)currentDialog=null;},{once:true});
    return d;
  }
  function fail(d,message){const output=$('.team-form-error',d);if(output)output.textContent=message;else toast(message);}
  function busy(form,value){
    form.dataset.busy=String(value);
    const fieldset=form.querySelector('.team-form-fields');if(fieldset)fieldset.disabled=value;
    const button=form.querySelector('button[type="submit"]');if(button){button.disabled=value||!getState().connected;button.textContent=value?'Saving…':button.dataset.label;}
  }
  function bindCancel(d,tab='people'){$('.team-cancel',d)?.addEventListener('click',()=>open(tab));}
  function roleFields(person,{newPerson=false}={}){
    const roles=editableRoles(),ids=roleIdsOf(person),defaultId=roles.some(role=>role.id==='operator')?'operator':roles.find(role=>role.id!=='viewer')?.id||roles[0]?.id||'viewer';
    const primary=newPerson?defaultId:(person?.roleId||defaultId);
    const extras=ids.filter(id=>id!==primary&&id!=='master');
    return `<label for="team-primary-role">Primary role</label><select id="team-primary-role" name="roleId" required>${roles.map(role=>`<option value="${escape(role.id)}" ${role.id===primary?'selected':''}>${escape(role.name)}</option>`).join('')}</select><p class="field-note">The primary role is recorded with their equipment actions.</p><fieldset class="team-extra-roles"><legend>Additional roles</legend><p class="field-note">Optional. Choose up to four more roles.</p><div class="team-role-choices">${roles.map(role=>`<label><input type="checkbox" name="extraRoles" value="${escape(role.id)}" ${extras.includes(role.id)?'checked':''} ${role.id===primary?'disabled':''}><span>${escape(role.name)}</span></label>`).join('')}</div><p class="team-role-count" role="status">${1+extras.length} of 5 roles selected</p></fieldset><div class="team-effective-permissions"><span class="label">Access preview</span><ul></ul></div>`;
  }
  function bindRoleFields(d){
    const form=$('.team-action-form',d),select=$('[name="roleId"]',form),choices=[...form.querySelectorAll('[name="extraRoles"]')];
    const update=()=>{
      for(const input of choices){const primary=input.value===select.value;input.disabled=primary;if(primary)input.checked=false;}
      const selected=[select.value,...choices.filter(input=>input.checked).map(input=>input.value)];
      $('.team-role-count',form).textContent=`${selected.length} of 5 roles selected`;
      const permissions=new Set(selected.flatMap(id=>getState().roles?.[id]?.permissions||[]));
      $('.team-effective-permissions ul',form).innerHTML=(['View docks, scanner dashboards, history, and messages addressed to them',...Object.entries(PERMISSIONS).filter(([id])=>permissions.has(id)).map(([,label])=>label)]).map(label=>`<li>${escape(label)}</li>`).join('');
    };
    select.onchange=update;
    choices.forEach(input=>input.onchange=()=>{
      if(choices.filter(choice=>choice.checked).length>4){input.checked=false;fail(d,'Choose a maximum of five roles, including the primary role.');}
      else $('.team-form-error',d).textContent='';
      update();
    });
    update();
  }
  function selectedRoles(form){
    const data=new FormData(form),roleId=String(data.get('roleId')||''),roleIds=[roleId,...data.getAll('extraRoles').map(String)];
    if(!roleId||roleIds.length>5)throw Error('Choose a primary role and no more than four additional roles.');
    return {roleId,roleIds:[...new Set(roleIds)]};
  }
  function directoryRows(tab,state){
    const query=filters.search.trim().toLocaleLowerCase();
    return Object.values(state.users||{}).filter(person=>{
      if(tab==='pending'&&!waiting(person))return false;
      if(tab==='people'&&filters.status==='active'&&!person.active)return false;
      if(tab==='people'&&filters.status==='inactive'&&person.active!==false)return false;
      if(filters.role!=='all'&&!roleIdsOf(person).includes(filters.role))return false;
      return !query||`${person.displayName} ${rolesFor(person).join(' ')}`.toLocaleLowerCase().includes(query);
    }).sort((a,b)=>a.displayName.localeCompare(b.displayName));
  }
  function refreshDirectory(tab,d){
    if(!d?.isConnected)return;
    const state=getState(),people=directoryRows(tab,state),all=Object.values(state.users||{}),canManage=master();
    const summary=$('.team-directory-summary',d);if(summary)summary.textContent=tab==='pending'?`${all.filter(waiting).length} awaiting access review`:`${all.filter(person=>person.active).length} active · ${all.filter(waiting).length} awaiting approval · ${all.filter(person=>person.active===false&&!waiting(person)).length} disabled`;
    const result=$('.team-directory-results',d);if(!result)return;
    result.innerHTML=people.length?people.map(person=>`<article class="team-member"><div class="team-member-avatar avatar" aria-hidden="true">${escape(person.displayName.slice(0,1))}</div><div class="team-member-info"><div class="team-member-name"><b>${escape(person.displayName)}</b>${person.uid===state.user.uid?'<span class="team-you">You</span>':''}<span class="team-member-status ${person.active?'active':'pending'}">${person.active?'Active':waiting(person)?'Awaiting approval':'Disabled'}</span></div><div class="team-member-roles">${badges(person)}</div>${!person.active?`<small class="team-registration">Account created ${escape(registrationTime(person.createdAt))}</small>`:''}${person.roleId==='master'&&canManage?'<small class="team-registration">Protected account with full administrative access.</small>':''}</div>${canManage&&person.roleId!=='master'&&person.uid!==state.user.uid?`<button type="button" class="btn ${waiting(person)?'primary':'secondary'} small team-edit-access" data-uid="${escape(person.uid)}">${waiting(person)?'Assign roles':'Edit access'}</button>`:''}</article>`).join(''):`<div class="empty-state">${tab==='pending'?'No accounts are awaiting access.':'No people match these filters.'}</div>`;
    result.querySelectorAll('.team-edit-access').forEach(button=>button.onclick=()=>editAccess(button.dataset.uid,tab));
    const count=$('.team-result-count',d);if(count)count.textContent=`${people.length} ${people.length===1?'person':'people'}`;
    const pendingTab=d.querySelector('[data-team-tab="pending"]');if(pendingTab)pendingTab.innerHTML=`Awaiting access${all.filter(waiting).length?` <span class="team-tab-count">${all.filter(waiting).length}</span>`:''}`;
  }
  function peopleView(tab){
    const state=getState(),roles=Object.values(state.roles||{}).sort((a,b)=>a.name.localeCompare(b.name));
    const d=show('Our team',`<div class="team-ui-shell"><div class="team-directory-scroll">${tabs(tab)}<div class="team-directory-heading"><div><h3>${tab==='pending'?'Review account access':'People and roles'}</h3><p class="team-directory-summary"></p></div><span class="team-result-count label"></span></div>${master()&&tab==='pending'?'<p class="field-note">New accounts wait here until you choose their roles and approve access. Use People to review or enable previously approved, disabled accounts.</p>':''}<div class="team-directory-filters"><div><label for="team-search">Find a person</label><input id="team-search" type="search" placeholder="Search name or role" value="${escape(filters.search)}" autocomplete="off"></div><div><label for="team-role-filter">Role</label><select id="team-role-filter"><option value="all">All roles</option>${roles.map(role=>`<option value="${escape(role.id)}" ${filters.role===role.id?'selected':''}>${escape(roleLabel(role.id))}</option>`).join('')}</select></div>${tab==='people'?`<div><label for="team-status-filter">Access</label><select id="team-status-filter"><option value="all" ${filters.status==='all'?'selected':''}>All people</option><option value="active" ${filters.status==='active'?'selected':''}>Active</option><option value="inactive" ${filters.status==='inactive'?'selected':''}>Inactive</option></select></div>`:''}</div><div class="team-directory-results" aria-live="polite"></div></div></div>`);
    d.dataset.teamTab=tab;
    $('#team-search',d).oninput=event=>{filters.search=event.target.value;refreshDirectory(tab,d);};
    $('#team-role-filter',d).onchange=event=>{filters.role=event.target.value;refreshDirectory(tab,d);};
    $('#team-status-filter',d)?.addEventListener('change',event=>{filters.status=event.target.value;refreshDirectory(tab,d);});
    refreshDirectory(tab,d);return d;
  }
  function editAccess(uid,returnTab='people'){
    if(!master())return;
    const person=getState().users?.[uid];if(!person){toast('This account is no longer available.');return;}
    if(person.roleId==='master'||uid===getState().user.uid){toast('The protected Master account keeps full access.');return;}
    const proposed=waiting(person)&&person.roleId==='viewer'?{...person,roleId:editableRoles().some(role=>role.id==='operator')?'operator':'viewer',roleIds:[]}:person;
    const saveLabel=waiting(person)?'Approve account':'Save access';
    const d=show(waiting(person)?'Approve account access':'Edit account access',`<form class="team-action-form" data-uid="${escape(getState().user.uid)}"><div class="team-form-scroll"><fieldset class="team-form-fields"><div class="team-form-person"><span class="avatar">${escape(person.displayName.slice(0,1))}</span><div><h3>${escape(person.displayName)}</h3><p>Created ${escape(registrationTime(person.createdAt))}</p></div></div>${roleFields(proposed)}<label class="team-active-choice"><input type="checkbox" name="active" ${person.active||waiting(person)?'checked':''}><span><b>Allow workspace access</b><small>Uncheck to disable this account without deleting its identity or history.</small></span></label><p class="field-note">Access is shared across the hub, dock app, and scanner app.</p></fieldset></div><div class="team-form-footer"><div class="team-form-error" role="alert"></div><div class="form-actions"><button type="button" class="btn secondary team-cancel">Cancel</button><button type="submit" class="btn" data-label="${saveLabel}" ${!getState().connected?'disabled':''}>${saveLabel}</button></div></div></form>`,true);
    bindCancel(d,returnTab);bindRoleFields(d);
    if(person.active)$('[name="active"]',d).checked=true;
    const form=$('.team-action-form',d);
    form.onsubmit=async event=>{
      event.preventDefault();if(form.dataset.uid!==getState().user?.uid)return fail(d,'Your account changed. Reopen this person’s access settings.');
      let roles;try{roles=selectedRoles(form);}catch(error){fail(d,error.message);return;}
      const active=form.elements.active.checked;busy(form,true);$('.team-form-error',d).textContent='';
      try{await getPlatform().assignRole({uid:person.uid,...roles,active});toast(!person.active&&active?'Account approved':'Account access saved');open(returnTab);}catch(error){fail(d,error.message);}finally{if(d.isConnected)busy(form,false);}
    };return d;
  }
  function addPerson(){
    const d=show('Add a teammate',`<form class="team-action-form" data-uid="${escape(getState().user.uid)}"><div class="team-form-scroll">${tabs('add')}<fieldset class="team-form-fields"><p class="field-note">Create an approved account and assign the access this person needs.</p><label for="team-person-name">Display name</label><input id="team-person-name" name="displayName" required minlength="2" maxlength="48" placeholder="e.g. Alex Rivera" autocomplete="off"><label for="team-person-pass">Password / passphrase</label><input id="team-person-pass" name="passphrase" type="password" required minlength="8" maxlength="128" placeholder="At least 8 characters" autocomplete="new-password"><p class="field-note">Give the passphrase directly to this person. It is not saved in the workspace database.</p>${roleFields(null,{newPerson:true})}</fieldset></div><div class="team-form-footer"><div class="team-form-error" role="alert"></div><div class="form-actions"><button type="button" class="btn secondary team-cancel">Cancel</button><button type="submit" class="btn" data-label="Create account" ${!getState().connected?'disabled':''}>Create account</button></div></div></form>`,true);
    bindCancel(d);bindRoleFields(d);const form=$('.team-action-form',d);
    form.onsubmit=async event=>{
      event.preventDefault();if(form.dataset.uid!==getState().user?.uid)return fail(d,'Your account changed. Reopen Add person.');
      let selected;try{selected=selectedRoles(form);}catch(error){fail(d,error.message);return;}
      const data=new FormData(form),payload={displayName:data.get('displayName'),passphrase:data.get('passphrase'),...selected};busy(form,true);$('.team-form-error',d).textContent='';
      try{await getPlatform().createUser(payload);form.elements.passphrase.value='';toast('Teammate account created');open('people');}catch(error){fail(d,error.message);}finally{if(d.isConnected)busy(form,false);}
    };return d;
  }
  function roleEditor(roleId=''){
    const state=getState(),role=state.roles?.[roleId];if(roleId==='master')return;
    const d=show(role?'Edit role':'Create a role',`<form class="team-action-form" data-uid="${escape(state.user.uid)}"><div class="team-form-scroll"><fieldset class="team-form-fields"><p class="field-note">Roles control operational permissions. Account and role administration stay with the protected Master account.</p>${role?`<p class="team-role-id">Role ID: <code>${escape(role.id)}</code></p>`:''}<label for="team-role-name">Role name</label><input id="team-role-name" name="name" required maxlength="40" value="${escape(role?.name||'')}" placeholder="e.g. Equipment coordinator"><fieldset class="team-permission-choices"><legend>Permissions</legend>${Object.entries(PERMISSIONS).map(([key,label])=>`<label><input type="checkbox" name="permissions" value="${key}" ${role?.permissions?.includes(key)?'checked':''}><span>${escape(label)}</span></label>`).join('')}</fieldset><p class="field-note">Every active person can view current equipment, history, and messages addressed to them. People with multiple roles receive the combined permissions.</p></fieldset></div><div class="team-form-footer"><div class="team-form-error" role="alert"></div><div class="form-actions"><button type="button" class="btn secondary team-cancel">Cancel</button><button type="submit" class="btn" data-label="Save role" ${!state.connected?'disabled':''}>Save role</button></div></div></form>`,true);
    bindCancel(d,'roles');const form=$('.team-action-form',d);
    form.querySelector('[value="scanner.manage"]').onchange=event=>{if(event.target.checked)form.querySelector('[value="scanner.use"]').checked=true;};
    form.querySelector('[value="scanner.use"]').onchange=event=>{if(!event.target.checked)form.querySelector('[value="scanner.manage"]').checked=false;};
    form.onsubmit=async event=>{
      event.preventDefault();if(form.dataset.uid!==getState().user?.uid)return fail(d,'Your account changed. Reopen the role editor.');
      const data=new FormData(form),name=String(data.get('name')||'').trim(),id=role?.id||name.toLocaleLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40);
      if(!/^[a-z][a-z0-9_]{1,39}$/.test(id))return fail(d,'Use a role name with at least two letters or numbers, starting with a letter.');
      if(!role&&state.roles?.[id])return fail(d,'A role with that name already exists. Edit the existing role or choose another name.');
      busy(form,true);$('.team-form-error',d).textContent='';
      try{await getPlatform().saveRole({id,name,permissions:data.getAll('permissions')});toast('Role saved');open('roles');}catch(error){fail(d,error.message);}finally{if(d.isConnected)busy(form,false);}
    };return d;
  }
  function rolesView(){
    const roles=Object.values(getState().roles||{}).sort((a,b)=>a.name.localeCompare(b.name));
    const d=show('Team roles',`<div class="team-ui-shell"><div class="team-directory-scroll">${tabs('roles')}<div class="team-directory-heading"><div><h3>Roles and permissions</h3><p>Assign one primary role and up to four additional roles.</p></div><button type="button" class="btn small team-new-role">New role</button></div><div class="team-scanner-setup"><div><b>Scanner role tools</b><p>Add Operator and Manager roles and scanner access for standard team roles. Existing dock and message permissions are kept.</p></div><button type="button" class="btn secondary small team-install-scanner-roles" ${!getState().connected?'disabled':''}>Update scanner roles</button></div><div class="team-form-error" role="alert"></div><div class="team-role-list">${roles.map(role=>`<article class="team-role-summary"><div><h4>${escape(roleLabel(role.id))}</h4><p>${role.id==='master'?'Full administrative and operational access':Object.entries(PERMISSIONS).filter(([key])=>role.permissions?.includes(key)).map(([,label])=>escape(label)).join(' · ')||'View workspace data and received messages'}</p></div>${role.id==='master'?'<span class="team-role-badge">Protected</span>':`<button type="button" class="btn secondary small team-edit-role" data-role="${escape(role.id)}">Edit</button>`}</article>`).join('')}</div></div></div>`);
    $('.team-new-role',d).onclick=()=>roleEditor();
    d.querySelectorAll('.team-edit-role').forEach(button=>button.onclick=()=>roleEditor(button.dataset.role));
    $('.team-install-scanner-roles',d).onclick=async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Updating…';try{await getPlatform().installScannerRoles();toast('Scanner roles updated');open('roles');}catch(error){fail(d,error.message);button.disabled=!getState().connected;button.textContent='Update scanner roles';}};
    return d;
  }
  function open(tab='people'){
    if(!getState().user){toast('Sign in to view your team.');return;}
    if(!master()&&tab!=='people')tab='people';
    if(tab==='pending'||tab==='people')return peopleView(tab);
    if(tab==='add')return addPerson();
    if(tab==='roles')return rolesView();
    return peopleView('people');
  }
  return {open,destroy(){currentDialog?.close();currentDialog=null;}};
}
