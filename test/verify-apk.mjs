// Verifies the built artifact with Android Build Tools and checks its packaged local assets.
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import assert from 'node:assert/strict';
const tooling=resolve('private/tooling');
const jdk=process.env.JAVA_HOME??join(tooling,(await readdir(tooling)).find(n=>n.startsWith('jdk-')));
const sdk=process.env.ANDROID_HOME??join(tooling,'android-sdk');
const apk=resolve(process.argv[2]??'android/app/build/outputs/apk/debug/app-debug.apk');
const expectedVersion=JSON.parse(await readFile('package.json','utf8')).version;
function run(executable,args){const r=spawnSync(executable,args,{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.stdout||r.error?.message||'Tool failed');return r.stdout;}
const signature=run(join(jdk,'bin','java.exe'),['-jar',join(sdk,'build-tools/35.0.0/lib/apksigner.jar'),'verify','--verbose','--print-certs','--min-sdk-version','26',apk]);
assert.match(signature,/Verifies/);assert.match(signature,/Verified using v2 scheme.*true/);
const badging=run(join(sdk,'build-tools/35.0.0/aapt.exe'),['dump','badging',apk]);
assert.match(badging,/package: name='local\.dailymotion'/);assert.match(badging,/sdkVersion:'26'/);assert.match(badging,/targetSdkVersion:'35'/);assert.match(badging,/application-label:'每日动一动'/);
const actualVersion=badging.match(/versionName='([^']+)'/)?.[1],versionCode=Number(badging.match(/versionCode='(\d+)'/)?.[1]);
assert.equal(actualVersion,expectedVersion,'APK version differs from current project');assert.ok(Number.isInteger(versionCode)&&versionCode>0);
const data=await readFile(apk);let end=-1;
for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break;}
assert.notEqual(end,-1,'APK ZIP directory missing');const count=data.readUInt16LE(end+10),entries=new Map();let pos=data.readUInt32LE(end+16);
for(let i=0;i<count;i++){
  assert.equal(data.readUInt32LE(pos),0x02014b50);const method=data.readUInt16LE(pos+10),size=data.readUInt32LE(pos+20),nameLength=data.readUInt16LE(pos+28),extra=data.readUInt16LE(pos+30),comment=data.readUInt16LE(pos+32),local=data.readUInt32LE(pos+42);
  const name=data.subarray(pos+46,pos+46+nameLength).toString('utf8');assert.equal(data.readUInt32LE(local),0x04034b50);const start=local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28);const payload=data.subarray(start,start+size);
  assert.ok(method===0||method===8,'Unsupported APK entry compression');entries.set(name,method===0?payload:inflateRawSync(payload));pos+=46+nameLength+extra+comment;
}
for(const name of ['app.js','core.js','index.html','quick-log.js','style.css','weekly-plan.js','coaching.js'])assert.deepEqual(entries.get(`assets/${name}`),await readFile(`web/${name}`),`${name} in APK differs from source`);
assert.ok([...entries.keys()].some(n=>/^classes\d*\.dex$/.test(n)));
assert.ok(entries.has('res/drawable/ic_launcher.xml'));
for(const name of entries.keys())assert.ok(!/(^|\/)(?:\.env|private|.*\.keystore)(\/|$)/.test(name),'Private configuration in APK');
const result={verifiedAt:new Date().toISOString(),apk,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),applicationId:'local.dailymotion',version:actualVersion,versionCode,minSdk:26,targetSdk:35,signatureV2:true,certificateSha256:signature.match(/certificate SHA-256 digest: (\w+)/)?.[1],packagedAssetsMatchSource:true,containsPrivateConfiguration:false,entryCount:entries.size};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/apk-verification.json',JSON.stringify(result,null,2)+'\n');await writeFile(`artifacts/apk-verification-${actualVersion}.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
