# Regenerate the compact ADEME/UTAC NEDC catalogue (Open Licence). Python stdlib only.
import urllib.request,json,zipfile,io,csv,re
from pathlib import Path
base='https://www.data.gouv.fr/api/1/datasets/emissions-de-co2-et-de-polluants-des-vehicules-commercialises-en-france/'
j=json.load(urllib.request.urlopen(base)); rows=set(); sources={}
for resource in j['resources']:
 match=re.match(r'\[(201[2-5])\]',resource['title'])
 if not match:continue
 year=int(match[1]);url=resource['url'];sources[str(year)]=url
 z=zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url,timeout=30).read()))
 for filename in z.namelist():
  if not filename.lower().endswith('.csv'):continue
  raw=z.read(filename)
  try:text=raw.decode('utf-8-sig')
  except UnicodeDecodeError:text=raw.decode('cp1252')
  data=csv.DictReader(io.StringIO(text),delimiter=';')
  for row in data:
   aliases = {'lib_mrq':['Marque','lib_mrq_doss'], 'lib_mod_doss':['Modèle dossier'], 'typ_cbr':['Carburant','energ','cod_cbr'], 'co2':['CO2 (g/km)','co2_mixte'], 'puiss_max':['Puissance maximale (kW)'], 'typ_boite_nb_rapp':['Boîte de vitesse'], 'conso_mixte':['Consommation mixte (l/100km)']}
   for key,alternatives in aliases.items():
    if key not in row:
     row[key]=next((row[a] for a in alternatives if a in row),'')
   row={k:v.strip() for k,v in row.items() if k and v is not None}
   def num(key):
    try:return float(row[key].replace(',','.'))
    except (ValueError,KeyError):return 0
   fuel=row.get('typ_cbr','');mixed=num('conso_mixte');co2=num('co2');kw=num('puiss_max')
   if fuel not in ('ES','GO') or not 2<=mixed<=25 or not 40<=co2<=600:continue
   make=row.get('lib_mrq',row.get('marque','')).strip().upper();model=row.get('lib_mod_doss',row.get('lib_mod','')).strip().upper()
   if not make or not model:continue
   auto=1 if row.get('typ_boite_nb_rapp','').startswith(('A','V')) else 0
   rows.add((year,make,re.sub(r'[^A-Z0-9]','',model),fuel,auto,int(co2),round(kw,1),round(mixed,1)))
 print(year,len(rows))
out={'publisher':'ADEME / UTAC','license':'Licence Ouverte / Open Licence','source':'https://www.data.gouv.fr/datasets/emissions-de-co2-et-de-polluants-des-vehicules-commercialises-en-france','sources':sources,'columns':['year','make','model','fuel','automatic','co2','powerKw','litersPer100Km'],'rows':sorted(rows)}
p=Path(__file__).resolve().parents[1] / 'public/consumption-catalog.json';p.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')));print('bytes',p.stat().st_size)
print([r for r in out['rows'] if r[1]=='HYUNDAI' and r[2]=='I20' and r[0] in (2011,2012)])
