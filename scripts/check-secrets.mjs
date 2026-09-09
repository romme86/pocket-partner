import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const forbidden =
  /(^|\/)(\.private|outputs|data|node_modules)(\/|$)|(^|\/)\.env($|\.(?!example$))|firebase-adminsdk.*\.json$|(^|\/)(id_ed25519|id_rsa)$/;
const secrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{25,}/,
  /\bsk_[A-Za-z0-9]{32,}/,
];
let failed = false;
for (const file of files) {
  if (forbidden.test(file)) {
    console.error('Private path staged:', file);
    failed = true;
    continue;
  }
  if (/\.(woff2?|png|jpg|mp3|wav|mp4|pdf)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (secrets.some((re) => re.test(text))) {
    console.error('Possible credential in:', file);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`Checked ${files.length} tracked paths for private files and credentials.`);
