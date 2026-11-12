// Prints a public deterministic login address, never a password.
import {displayNameLoginAddress} from '../dist/shared/platform.js';
const name=process.argv.slice(2).join(' ').normalize('NFKC').trim().replace(/\s+/g,' ');
try{console.log(JSON.stringify({displayName:name,loginAddress:await displayNameLoginAddress(name)},null,2));}catch(error){console.error(error.message);process.exitCode=1;}
