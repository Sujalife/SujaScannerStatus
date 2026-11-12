import {readFile,readdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist');
const errors=[];
async function walk(dir){let files=[];for(const item of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,item.name);if(item.isDirectory())files.push(...await walk(path));else files.push(path)}return files}
for(const file of await walk(dist)){
 if(!/\.(html|css|js|webmanifest)$/.test(file))continue;
 const body=await readFile(file,'utf8');
 if(file.endsWith('.html'))for(const match of body.matchAll(/(?:src|href)="([^"#]+)"/g)){
   if(/^(https?:|data:)/.test(match[1]))continue;
   try{await access(resolve(dirname(file),match[1]))}catch{errors.push(`Missing asset ${match[1]} from ${file}`)}
 }
 if(file.endsWith('.js'))for(const match of body.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){
  try{await access(resolve(dirname(file),match[1]))}catch{errors.push(`Missing module ${match[1]} from ${file}`)}
 }
}
const {appLinks}=await import(pathToFileURL(resolve(dist,'shared/config.js')).href);
const manifest=JSON.parse(await readFile(resolve(dist,'manifest.webmanifest'),'utf8'));
const origin=appLinks.hub||'https://scope-check.invalid/',scope=new URL(manifest.scope||'./',origin);
for(const value of [manifest.start_url,...(manifest.shortcuts||[]).map(item=>item.url),...Object.values(appLinks).filter(Boolean)]){
 const url=new URL(value,origin);if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))errors.push(`App navigation leaves manifest scope: ${url.href}`);
}
if(errors.length)throw Error(errors.join('\n'));
console.log('Static build verified: hub, dock, scanner, linked assets/modules, and app navigation scope.');
