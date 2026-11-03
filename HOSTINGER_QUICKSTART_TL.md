# AlpasFarm sa Hostinger — gabay sa pag-setup

## Mahalagang kailangan sa live camera

Ang kasalukuyang Hostinger Web/Cloud plan ay puwedeng magpatakbo ng Node.js app kung suportado ito ng plan mo. Pero ang goat/sheep detector ng AlpasFarm ay Python/FastAPI at gumagamit ng YOLO weights. Ayon sa Hostinger, VPS lang ang may Python runtime at root access na kailangan nito. Para gumana ang camera detection at QR-linked movement alerts sa iisang Hostinger setup, gumamit ng Linux VPS na may Docker template. Tingnan ang [Python support sa Hostinger](https://www.hostinger.com/support/which-programming-languages-and-frameworks-are-supported-at-hostinger/) at ang [Docker VPS setup](https://www.hostinger.com/support/12040815-how-to-deploy-your-first-container-with-hostinger-docker-manager/).

Kailangan din ng HTTPS para makagamit ng camera ang Android browser. Ang Caddy sa Compose file ang kusang kukuha at magre-renew ng HTTPS certificate kapag nakaturo na ang domain sa VPS.

## 1. Ihanda ang Hostinger VPS at domain

1. Sa Hostinger, gumawa o pumili ng Linux VPS at ilagay ang Docker template. Hindi kailangang palitan ang Web/Cloud plan mo; hiwalay na VPS ang magpapatakbo ng Python camera service.
2. Gumamit ng subdomain gaya ng `farm.example.com` para sa AlpasFarm. Kunin ang public IPv4 ng VPS.
3. Sa DNS zone ng domain, magdagdag ng `A` record: `Name` = subdomain prefix, `Points to` = VPS IPv4. Huwag baguhin ang root (`@`) record kung may kasalukuyang website o email ka roon. Alisin lang ang lumang/conflicting A o AAAA record para sa mismong subdomain. Maaaring abutin ng ilang oras ang DNS propagation; tingnan ang [Hostinger A-record guide](https://support.hostinger.com/en/articles/1583249-how-to-manage-dns-records-at-hostinger).
4. Sa firewall ng Hostinger VPS, payagan ang inbound TCP `80` at `443`. Iwanang pribado ang ports `3000` at `8000`; Compose ang mga iyon sa internal network lang.

## 2. Gumawa ng upload archive mula sa kasalukuyang project

Buksan ang PowerShell sa project folder at patakbuhin:

```powershell
.\scripts\package-hostinger.ps1
```

Gagawa ito ng ZIP sa `deploy/hostinger/upload-bundles/`. Kasama rito ang kasalukuyang local changes; hindi kasama ang credentials, `.git`, `node_modules`, Python virtual environment, datasets, o private model weights.

## 3. Ilipat ang files sa VPS

Sa PowerShell, palitan ang `VPS_IP` at ang pangalan ng ZIP ayon sa output ng packaging script:

```powershell
ssh root@VPS_IP "mkdir -p /opt/alpasfarm"
scp .\deploy\hostinger\upload-bundles\alpasfarm-source-TIMESTAMP.zip root@VPS_IP:/opt/alpasfarm/source.zip
```

Pagkatapos, kumonekta sa VPS at i-extract ang source:

```sh
ssh root@VPS_IP
apt-get update && apt-get install -y unzip
cd /opt/alpasfarm
unzip -o source.zip
mkdir -p ml-server/models
mkdir -p ml-server/models/active
exit
```

Mula sa project folder sa Windows, ilipat nang hiwalay ang pribadong detector weights:

```powershell
scp .\ml-server\models\active\best.pt root@VPS_IP:/opt/alpasfarm/ml-server/models/active/best.pt
```

Huwag ilagay ang `best.pt` sa GitHub, ZIP archive, o `public/` folder. Naka-mount ito nang pribado sa ML container.

## 4. Ilagay ang production settings

Sa VPS:

```sh
cd /opt/alpasfarm
cp deploy/hostinger/env.example .env.hostinger
nano .env.hostinger
```

Itakda ang mga sumusunod:

- `ALPAS_DOMAIN` — domain/subdomain lang, walang `https://`.
- `VITE_SUPABASE_URL` at `VITE_SUPABASE_ANON_KEY` — mula sa kasalukuyang app configuration/Supabase project.
- `ML_API_SECRET` — gumawa ng bagong random value sa VPS gamit ang `openssl rand -hex 32`, at ilagay ang resultang value. Pareho itong ginagamit ng Node API at ML service.
- `SUPABASE_SERVICE_ROLE_KEY` — kailangan para sa server-side admin/auth-audit features; kopyahin lang sa server environment kung ginagamit ang mga feature na iyon. Huwag kailanman lagyan ng `VITE_` prefix o ilagay sa frontend.
- `GEMINI_API_KEY` — ilagay ang Gemini key para Gemini ang unang gamitin ng Health Camera. Default na model ang `gemini-3.6-flash`; optional ang `GEMINI_VISION_MODEL`. Kapag hindi naka-configure o nag-error ang Gemini request, susubukan ang nakatakdang `GROQ_API_KEY` bilang fallback. Puwede pa ring magkaroon ng pansamantalang provider rate limit. Huwag ilagay ang key sa chat o sa variable na may `VITE_` prefix.
- Iwanang blanko ang Groq/SMS/email secrets kung hindi mo pa ikinokonekta ang mga provider na iyon.

Itago ang `.env.hostinger` sa VPS lang. Huwag i-commit o i-upload sa public repository.

## 5. I-update ang Google login redirect sa Supabase

Sa Supabase Dashboard → **Authentication → URL Configuration**:

- Itakda ang **Site URL** sa `https://YOUR_DOMAIN`.
- Idagdag ang `https://YOUR_DOMAIN/**` sa **Redirect URLs**.

Panatilihin ang kasalukuyang Google OAuth callback URL na ibinigay ng Supabase sa Google Cloud Console.

## 6. Simulan ang website, API, at detector

Sa VPS:

```sh
cd /opt/alpasfarm
docker compose --env-file .env.hostinger -f compose.hostinger.yml up -d --build
docker compose --env-file .env.hostinger -f compose.hostinger.yml ps
docker compose --env-file .env.hostinger -f compose.hostinger.yml logs --tail=100 api ml-server caddy
```

Hintaying `healthy` ang `ml-server` at tumakbo ang Caddy certificate setup. Buksan ang `https://YOUR_DOMAIN` sa Android Chrome, mag-sign in, payagan ang camera, at buksan ang live monitoring page.

Para sa camera check, kailangang naka-open ang website at active ang camera permission sa browser. Ang activity classifier sa kasalukuyang build ay pang-eksperimento lamang; sheep lang ang sinusuportahan nito at hindi ito veterinary diagnosis. Basahin ang [ML notes](ml-server/README.md) bago umasa sa alert para sa health decision.

## Kung Web/Cloud lang muna ang gagamitin

Puwedeng i-host ang dashboard at Node.js API sa suportadong Hostinger Web/Cloud plan, pero kailangang ilagay ang Python/YOLO service sa hiwalay na VPS o Python host at itakda ang `ML_BACKEND_URL` sa HTTPS address nito. Kapag wala pa ang Python service, magbubukas ang dashboard pero hindi gagana ang live goat/sheep detection at anomaly alerts. Tingnan ang [Hostinger Node.js plan requirements](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/).
