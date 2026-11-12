import {cp,mkdir,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),target=process.argv[2];
const repos={hub:'SujaLifeTools',dock:'SujaDockStatus',scanner:'SujaScannerStatus'};
if(!Object.hasOwn(repos,target))throw Error('Choose hub, dock, or scanner');
const out=resolve(root,'..',`github-${repos[target]}`),host='https://sujalife.github.io',hubUrl=`${host}/SujaLifeTools/`;
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const name of ['dist','scripts','package.json','.gitignore','AGENTS.md','ARTWORK.md','.github'])await cp(resolve(root,name),resolve(out,name),{recursive:true});
if(target==='hub'){
 for(const name of ['package-lock.json','tests','database.rules.json','firebase.json','firebase-rules-status.json','SETUP.md','README.md','SCANNER_CONTRACT.md'])await cp(resolve(root,name),resolve(out,name),{recursive:true});
}else{
 const name=target==='scanner'?'Suja Scanner Status':'Suja Dock Status';
 await writeFile(resolve(out,'README.md'),`# ${name}\n\nStandalone frontend export sharing Firebase Authentication, role assignments, messages and themes with [Suja Life Tools](${hubUrl}).\n\nThe canonical app is [${name}](${hubUrl}${target}/). The hub opens apps beneath its own path so navigation stays within its installed-app scope. This separate repository remains available for standalone deployment. Shared artwork is served from the hub so every export uses the same assets.\n\nThe authoritative shared source, current rules, setup instructions and tests are in [SujaLifeTools](https://github.com/Sujalife/SujaLifeTools). Publish the complete version 3 rules there before using scanner actions, multi-role assignments, or new account approvals. No account or Master UID reset is needed. This repository does not carry a separate rules copy.\n\nThe app uses direct Firebase Auth and Realtime Database access protected by rules. Core operation requires no Cloud Functions or Blaze upgrade. Firebase service limits apply. Only the Console-pinned Master can create/assign roles. New accounts remain pending until approved.\n\nScanner fleet: SCNR-001 through SCNR-020 have stable keys and Master-editable names/home locations. Current state starts unconfirmed. Every real action records actor, primary role, server time, location, condition and an immutable event. Scanner history remains available; dock history and ordinary messages retain their 72-hour display/cleanup window.\n\nOverdue scanners create persistent in-app notices for Lead, Supervisor, Manager and Master after 12 hours while an authorized app is open. Notices clear on return. Pending accounts notify Master in the shared message center and approval queue. No closed-browser push, email, or SMS service is configured.\n\nPersonal alert preferences, compact phone layouts, fixed Save actions, independent grid/list views and both themes are shared. No demo mode or sample operational records are included.\n\nThe workflow attempts to enable GitHub Pages with GitHub Actions. If repository policy requires administrator setup, select Settings → Pages → Source → GitHub Actions. The canonical hub app can already be used independently of standalone Pages setup.\n`);
 await rm(resolve(out,'scripts/rules.mjs'),{force:true});
 const pkg=JSON.parse(await readFile(resolve(out,'package.json'),'utf8'));pkg.name=target==='scanner'?'suja-scanner-status':'suja-dock-status';pkg.scripts.test='node scripts/check.mjs';delete pkg.scripts['test:rules'];delete pkg.devDependencies;await writeFile(resolve(out,'package.json'),JSON.stringify(pkg,null,2)+'\n');
 await writeFile(resolve(out,'.github/workflows/pages.yml'),`name: Publish site
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm test && npm run build
      - uses: actions/configure-pages@v5
        with:
          enablement: true
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
`);
 let entry=await readFile(resolve(out,`dist/${target}/index.html`),'utf8');entry=entry.replaceAll('../assets/','./assets/').replaceAll('../shared/','./shared/').replaceAll('../manifest.webmanifest','./manifest.webmanifest');await writeFile(resolve(out,'dist/index.html'),entry);
}
// Every shared navigation link stays within the hub's installed application scope.
const configPath=resolve(out,'dist/shared/config.js');let config=await readFile(configPath,'utf8');for(const [key,url] of Object.entries({hub:hubUrl,dock:hubUrl+'dock/',scanner:hubUrl+'scanner/',assets:hubUrl+'assets/'}))config=config.replace(`${key}: ''`,`${key}: '${url}'`);await writeFile(configPath,config);
const manifestPath=resolve(out,'dist/manifest.webmanifest');const manifest=JSON.parse(await readFile(manifestPath,'utf8'));if(target!=='hub'){manifest.id=hubUrl;manifest.start_url=hubUrl;manifest.scope=hubUrl;manifest.shortcuts=manifest.shortcuts.map(shortcut=>({...shortcut,url:new URL(shortcut.url,hubUrl).href}));}await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
for(const name of ['index.html','dock/index.html','scanner/index.html']){
 const path=resolve(out,'dist',name);let html=await readFile(path,'utf8');const publicAssets=hubUrl+'assets/';html=html.replaceAll('https://suja-life-tools.fatherearth.chatgpt.site/assets/',publicAssets);if(target!=='hub')html=html.replaceAll('../assets/',publicAssets).replaceAll('./assets/',publicAssets);await writeFile(path,html);
}
if(target!=='hub'){
 const assets=resolve(out,'dist/assets');for(const file of await readdir(assets))if(!file.endsWith('.svg'))await rm(resolve(assets,file));
 const shared=resolve(out,'dist/shared');for(const file of await readdir(shared))if(file.endsWith('.css')){const path=resolve(shared,file),css=await readFile(path,'utf8');await writeFile(path,css.replaceAll('../assets/',hubUrl+'assets/'));}
 const path=resolve(out,'dist/manifest.webmanifest'),manifest=JSON.parse(await readFile(path,'utf8'));manifest.icons=manifest.icons.map(icon=>({...icon,src:new URL(icon.src,hubUrl).href}));manifest.shortcuts=manifest.shortcuts.map(shortcut=>({...shortcut,icons:(shortcut.icons||[]).map(icon=>({...icon,src:new URL(icon.src,hubUrl).href}))}));await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
}
console.log(out);
