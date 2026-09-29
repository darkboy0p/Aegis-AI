import {readdirSync,readFileSync,statSync} from 'node:fs';import {join} from 'node:path';
const pats=[/[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/,/-----BEGIN (RSA |EC )?PRIVATE KEY-----/,/gh[pousr]_[A-Za-z0-9]{36,}/,/AIza[0-9A-Za-z_-]{35}/];
let bad=0;const walk=d=>{for(const f of readdirSync(d)){if(['node_modules','.git'].includes(f))continue;const p=join(d,f);if(statSync(p).isDirectory())walk(p);else{const t=readFileSync(p,'utf8');if(pats.some(r=>r.test(t))){console.error('SECRET-LIKE:',p);bad++}}}};
walk('.');if(bad)process.exit(1);console.log('secret scan clean');
