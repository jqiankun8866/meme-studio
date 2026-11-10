"""Verify the public release; --write is for reviewed maintainer builds only."""
from pathlib import Path
import argparse,hashlib,json,re
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--write',action='store_true');a=p.parse_args()
skip={'.git','node_modules','__pycache__','dist','runtime'}
files={}
for f in root.rglob('*'):
 rel=f.relative_to(root)
 if any(x in skip for x in rel.parts):continue
 if f.is_symlink():raise SystemExit('Symlink in distribution: '+str(rel))
 if not f.is_file() or f.suffix=='.pyc' or rel.as_posix()=='SHA256SUMS.json':continue
 if f.name in {'vision.json','panel-access.json','panel.lock','DevToolsActivePort'}:raise SystemExit('Private runtime file: '+str(rel))
 if any(x in {'browser-profile','memes','.assistant','.dsh','.dsh-plugin-wechat','browser-profiles'} for x in rel.parts) or f.name.startswith(('.env','cookies','credentials')) or re.search(r'\.(sqlite|db)(?:-|$)',f.name) or f.suffix.lower() in {'.log','.exe','.dll','.zip','.7z','.pfx','.pem','.key'}:raise SystemExit('Private/generated file: '+str(rel))
 data=f.read_bytes()
 if f.suffix.lower() in {'.md','.txt','.json','.jsonl','.csv','.html','.ini','.toml','.conf','.js','.mjs','.cjs','.ts','.py','.ps1','.cmd','.yml','.yaml','.xml'}:
  text=data.decode('utf-8-sig')
  patterns=[r'sk-[A-Za-z0-9]{24,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'wxid_[A-Za-z0-9]{10,}',r'(?i)[A-Z]:[/\\]Users[/\\][A-Za-z0-9_.-]+[/\\]',r'(?i)<SS\b[^>]*>\s*[0-9a-f]{40,}']
  if any(re.search(pattern,text) for pattern in patterns):raise SystemExit('Possible private material: '+str(rel))
 files[rel.as_posix()]=hashlib.sha256(data).hexdigest()
manifest=root/'SHA256SUMS.json'
if a.write:manifest.write_text(json.dumps(files,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
expected=json.loads(manifest.read_text(encoding='utf-8'))
bad=sorted(k for k in files.keys()|expected.keys() if files.get(k)!=expected.get(k))
if bad:raise SystemExit('Manifest mismatch: '+', '.join(bad[:10]))
print(json.dumps({'verified':True,'files':len(files),'privateMaterialPatternScan':'passed (bounded patterns; not a guarantee)','mode':'maintainer-write' if a.write else 'verify'}))
