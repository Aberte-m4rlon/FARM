# AlpasFarm sa AWS — gabay sa pag-deploy

Ang kasalukuyang `compose.hostinger.yml` ay Docker Compose stack para sa website, Node API, Caddy HTTPS, at private Python/YOLO detector. Maaari itong patakbuhin sa Ubuntu VM sa AWS; hindi kailangan ang Cloudflare para gumana.

## 1. Suriin muna ang $300 AWS credit

Sa AWS Console, buksan ang **Billing and Cost Management → Credits** at tingnan ang:

- natitirang credit at expiration date;
- kung kasama sa eligible services ang **Amazon Lightsail** at/o **Amazon EC2**;
- kung pinapayagan ng account plan mo ang serbisyong balak gamitin.

AWS ang kusang mag-a-apply ng credit sa eligible charges. Hindi sakop ng lahat ng credit ang lahat ng serbisyo; hindi rin karaniwang sakop ang tax, domain registration sa Route 53, AWS Marketplace, at ilang ibang bayarin. Tingnan ang [AWS Promotional Credit terms](https://aws.amazon.com/awscredits/) at [paano ina-apply ang credits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html). Huwag gumawa ng server hangga't hindi mo nakukumpirma ang eligible service at expiry.

## 2. Piliin ang AWS server

**Mas madaling opsyon kapag eligible ang Lightsail:**

1. Buksan ang [Amazon Lightsail](https://lightsail.aws.amazon.com/), piliin ang **Create instance**.
2. Piliin ang Linux/Unix at **Ubuntu OS-only** blueprint.
3. Piliin ang **8 GB RAM / 2 vCPU** bundle kung kasama sa credit. Nakalista ang bundle sa kasalukuyang AWS pricing page sa humigit-kumulang `$44 USD/buwan`; ang $300 ay katumbas ng mga 6.8 buwan sa list price, bago ang posibleng buwis, overage, o mas maagang credit expiry. Suriin ang presyo sa AWS Console bago kumpirmahin. [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/)
4. Pagkatapos malikha ang instance, gumawa at ikabit ang **Static IP** para hindi magbago ang DNS target kapag ni-restart ang VM. [Gabay sa Static IP](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html)

**Kung EC2 lang ang eligible:** gumawa ng Ubuntu EC2 VM na may hindi bababa sa 8 GB RAM, at gumamit ng AWS Pricing Calculator para sa eksaktong rehiyon, disk, public IPv4, at data transfer. Mag-allocate at mag-attach ng Elastic IP para hindi magbago ang DNS target kapag na-stop/restart ang instance. Mas maraming AWS networking at billing settings ang kailangang ayusin kumpara sa Lightsail. [AWS EC2 networking](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-networking.html)

Mag-set din ng AWS Budget alert bago magpatakbo ng workload. Kapag naubos o nag-expire ang credit, maaaring magsimulang maningil ang AWS sa regular na rates.

## 3. Itakda ang firewall

Sa Lightsail **Networking** o EC2 **Security Group**, payagan ang inbound traffic sa:

- `22/TCP` SSH — limitahan sa sarili mong public IP kung maaari;
- `80/TCP` HTTP — para sa HTTPS certificate setup;
- `443/TCP` HTTPS — para sa website at Android camera access.

Huwag buksan sa publiko ang `3000` at `8000`; internal Docker services ang Node API at Python ML service.

## 4. Ituro ang domain

Panatilihin ang domain mo sa Hostinger. Sa Hostinger DNS editor, gumawa ng `A` record para sa subdomain, halimbawa `farm.example.com`, at ituro ito sa AWS Static IP. Huwag baguhin ang root (`@`) o email DNS records. Hintaying mag-resolve ang subdomain bago simulan ang app; si Caddy ang kukuha ng HTTPS certificate.

Opsyonal ang Cloudflare. Pinakasimple munang panatilihin ang DNS sa Hostinger at ituro ang subdomain diretso sa AWS. Kung ililipat mo ang nameservers sa Cloudflare, kopyahin muna roon ang lahat ng kasalukuyang DNS records para hindi maputol ang email o ibang website. Kung gagamitin ang Cloudflare proxy, itakda ang SSL/TLS mode sa **Full (strict)**.

## 5. Ikonekta sa Ubuntu VM at i-install ang Docker

Gamitin ang Lightsail browser SSH, o Windows OpenSSH kasama ang private key na ginawa/ibinigay para sa VM. Sa Ubuntu, sundin ang opisyal na [Docker Engine installation para sa Ubuntu](https://docs.docker.com/engine/install/ubuntu/). I-install ang Docker Engine at Compose plugin, saka tiyakin na gumagana ang `docker --version` at `docker compose version`.

## 6. I-upload ang source at YOLO weights

I-download ang [AlpasFarm upload ZIP](deploy/hostinger/upload-bundles/alpasfarm-source-20261004-115626.zip). Pribado ang `best.pt`, kaya hiwalay itong i-upload mula sa project folder sa Windows. Sa PowerShell, ilagay ang VM IP at private key path:

```powershell
$AWS_IP = "YOUR_AWS_STATIC_IP"
$AWS_KEY = "C:\path\to\your-aws-key.pem"
$BUNDLE = "C:\path\to\alpasfarm-source-20261004-115626.zip"
$WEIGHTS = "C:\Users\asiva\Downloads\capstone-master\ALPASFARM-work\ml-server\models\active\best.pt"

scp -i $AWS_KEY $BUNDLE "ubuntu@${AWS_IP}:/home/ubuntu/source.zip"
scp -i $AWS_KEY $WEIGHTS "ubuntu@${AWS_IP}:/home/ubuntu/best.pt"
ssh -i $AWS_KEY "ubuntu@${AWS_IP}"
```

Sa Ubuntu SSH terminal:

```sh
sudo apt-get update && sudo apt-get install -y unzip
mkdir -p ~/alpasfarm
unzip -o ~/source.zip -d ~/alpasfarm
mkdir -p ~/alpasfarm/ml-server/models/active
mv ~/best.pt ~/alpasfarm/ml-server/models/active/best.pt
cd ~/alpasfarm
```

## 7. I-configure ang app secrets

Sa Ubuntu terminal:

```sh
cp deploy/hostinger/env.example .env.hostinger
chmod 600 .env.hostinger
openssl rand -hex 32
nano .env.hostinger
```

Ilagay sa file ang:

- `ALPAS_DOMAIN` — domain o subdomain, walang `https://`;
- `VITE_SUPABASE_URL` at `VITE_SUPABASE_ANON_KEY` — mula sa kasalukuyang app configuration;
- `ML_API_SECRET` — random value na inilabas ng `openssl rand -hex 32`;
- `SUPABASE_SERVICE_ROLE_KEY` — kailangan ng server-side admin at auth-audit features; panatilihin ito sa server lang.

Iwanang blanko ang optional AI/SMS/email keys kung hindi mo ikinokonekta ang mga provider. Huwag ilagay ang `.env.hostinger` o `best.pt` sa GitHub o sa public folder.

## 8. I-update ang Google login URL sa Supabase

Sa Supabase Authentication → URL Configuration, itakda ang **Site URL** sa `https://YOUR_SUBDOMAIN` at idagdag ang `https://YOUR_SUBDOMAIN/**` sa **Redirect URLs**. Panatilihin ang kasalukuyang Google OAuth callback URL na Supabase ang nagbigay.

## 9. I-build at patakbuhin

Sa Ubuntu terminal:

```sh
cd ~/alpasfarm
sudo docker compose --env-file .env.hostinger -f compose.hostinger.yml up -d --build
sudo docker compose --env-file .env.hostinger -f compose.hostinger.yml ps
sudo docker compose --env-file .env.hostinger -f compose.hostinger.yml logs --tail=100 api ml-server caddy
```

Kapag `healthy` na ang `ml-server` at gumagana ang HTTPS, buksan ang `https://YOUR_SUBDOMAIN` sa Android Chrome, mag-sign in, payagan ang camera, at buksan ang live monitoring page.

Ang current activity classifier ay experimental sheep activity estimate; hindi ito veterinary diagnosis at huwag itong gamiting tanging batayan para sa health decision. Tingnan ang [ML notes](ml-server/README.md).
