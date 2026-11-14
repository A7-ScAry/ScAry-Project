// Generate your OWN VAPID keys locally. Never commit the private key to GitHub.
import { generateKeyPairSync } from 'node:crypto';
const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const {x,y,d}=privateKey.export({format:'jwk'});
const encode=buf=>Buffer.from(buf).toString('base64url');
const publicKey=encode(Buffer.concat([Buffer.from([4]),Buffer.from(x,'base64url'),Buffer.from(y,'base64url')]));
console.log('\nCopy these three values to ScAry Project’s Cloudflare Pages Settings → Variables and Secrets:');
console.log('VAPID_PUBLIC_KEY =',publicKey);
console.log('VAPID_PRIVATE_KEY =',d);
console.log('VAPID_SUBJECT = mailto:your-email@example.com (replace with an email you control)');
console.log('\nStore VAPID_PRIVATE_KEY as an encrypted Secret. Do NOT put it in GitHub or screenshots.');
