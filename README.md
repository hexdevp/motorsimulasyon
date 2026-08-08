<div align="center">

# Motor Simülasyonu

**Krank açısı çözünürlüklü içten yanmalı motor simülatörü — tarayıcıda.**

### [▶ Canlı demo — hexdevp.github.io/motorsimulasyon](https://hexdevp.github.io/motorsimulasyon/)

Kurulum yok, hesap yok, sunucu yok. Aç ve kullan.

![Lisans](https://img.shields.io/badge/test-204%20ge%C3%A7iyor-brightgreen)
![Fizik](https://img.shields.io/badge/%C3%A7%C3%B6z%C3%BCc%C3%BC-0D%20krank%20a%C3%A7%C4%B1s%C4%B1-blue)
![Boyut](https://img.shields.io/badge/tek%20dosya-364%20KB-lightgrey)
![Dil](https://img.shields.io/badge/dil-TR%20%2F%20EN-informational)

</div>

---

## Bu ne?

Çoğu "motor simülatörü" aslında bir **eğri uydurmadır**: birkaç parametre alır,
hazır bir tork eğrisini ölçekler ve sonucu gösterir. Bu öyle değil.

Burada her çalışma noktası için termodinamik çevrim **720° boyunca 0.5°
adımlarla** çözülür. Enerji korunumu her adımda entegre edilir; basınç,
sıcaklık ve kütle bileşimi bunun sonucudur. Tork, o çevrimin altındaki alandan
çıkar — tersi değil.

Pratikte farkı şudur: **girmediğiniz hiçbir şey uydurulmaz.** "Yanma süresi"
diye bir giriş kutusu yoktur, çünkü yanma süresi alev hızından türetilir. Alev
hızı da karışım oranına, sıcaklığa, basınca ve türbülansa bağlıdır. Kam
süresini uzattığınızda düşük devir torkunun neden düştüğünü model size
*hesaplayarak* söyler.

## Neler var

- **12 hazır motor** — 2JZ-GTE, LS3, K20A, EJ257, B58, RB26DETT, Coyote, Barra,
  EA888, Viper V10, Ferrari F140 V12, 4A-GE. Hepsinin ~60 parametresi
  düzenlenebilir.
- **Gerçek zamanlı sürüş** — motor bir aracın içinde. Debriyaj kayar ve ısınır,
  lastik patinaj yapar, motor stall eder. Klavyeyle sürersiniz.
- **Sentezlenmiş motor sesi** — kayıt değil, ateşleme frekansından üretiliyor.
  Silindir sayısı, mimari ve hacim sesi değiştirir; V8 ile I4 farklı duyulur.
- **Canlı 2D animasyon** — pistonlar, supaplar, alev cephesi. Uydurma değil,
  çözücünün ürettiği izden sürülüyor.
- **Kalibrasyon yazılımı gibi yakıt haritası** — tıkla-sürükle seçim, Excel'e
  kopyala-yapıştır, ara değer hesabı, yumuşatma.
- **Kök-neden teşhisi** — "vuruntu var" demez; vuruntuya hangi etkenin ne kadar
  katkı yaptığını ayrıştırır.
- **Ortam koşulları** — rakım, nem, sıcaklık. Denver'da (1600 m) LS3 gücünün
  %20'sini kaybeder ve model bunu kendisi bulur.
- **Türkçe / İngilizce** arayüz.

---

## Hızlı başlangıç

**Sadece kullanmak istiyorsanız:**
[hexdevp.github.io/motorsimulasyon](https://hexdevp.github.io/motorsimulasyon/)
adresini açın. Hepsi bu.

**Kaynaktan çalıştırmak:**

```bash
npm install && npm run dev
```

**Derlemek:**

```bash
npm run build
```

Çıktı `dist/index.html` — JavaScript, CSS ve tüm veri içine gömülmüş **tek bir
dosya**. Harici istek yapmaz, internet olmadan çalışır, e-postayla
gönderilebilir.

**Testler:**

```bash
npm test
```

> **Not:** Arayüz masaüstü içindir. Sürüş sekmesi klavye gerektirir ve paneller
> geniş ekrana göre yerleşir. Telefonda açılır, ama sürüş bölümü kullanılamaz.

---

## Sekmeler

| Sekme | İçerik |
|---|---|
| **Motor Kurulumu** | 12 hazır motor + ~60 parametrenin tamamı düzenlenebilir |
| **Animasyon** | Canlı 2D silindir kesiti + çoklu silindir görünümü |
| **Güç & Tork** | RPM süpürmesi; tork/güç/VE/avans/basınç eğrileri ve detay tablosu |
| **Silindir İçi** | P-V diyagramı, basınç ve sıcaklık izi, ısı bırakma, supap kalkışı |
| **Yakıt Haritası** | MAP × RPM ızgarası — darbe genişliği, VE, avans, lambda, doluluk |
| **Teşhis** | Durum kontrolü, kök-neden analizi, enerji dengesi, sürtünme dökümü |
| **Sürüş** | Araç içinde gerçek zamanlı sürüş — gösterge paneli ve aktarma şeması |
| **Canlı Sim** | Gaz pedalı, atalet ile gerçek zamanlı devir, rev limiter |
| **Analiz Raporu** | Statik özellikler + devir tablosu + değerlendirme, Markdown çıktı |

### Sürüş

Motor dinamometrede değil, bir aracın içinde. Her motorun eşleştiği bir araç var
(2JZ → Supra, LS3 → Corvette, K20A → Civic Type R…) ve zincirin tamamı
modelleniyor: motor → debriyaj → vites kutusu → şaft → diferansiyel → tekerlek
→ yol.

| Tuş | İşlev | | Tuş | İşlev |
|---|---|---|---|---|
| `W` | Gaz | | `E` | Vites yukarı |
| `S` | Fren | | `Q` | Vites aşağı |
| `Shift` | Debriyaj | | `Space` | El freni |
| `C` | Yarım debriyaj | | `R` | Marş (basılı tut) |

Pedallar ani değil kademeli hareket eder — debriyajı yavaş bırakabilmeyi ve
gerçek pedal hissini veren şey budur.

Modelin kritik tarafı zincirin her yerinde **ayrılabilir** olması: debriyaj
kayabilir (ve ısınır), lastik patinaj yapabilir, vites boşta olabilir, motor
stall edebilir. Şema bunların hepsini canlı gösterir — güç akış oklarının
kalınlığı o an geçen torka göre değişir, motor freninde yön tersine döner.

Gösterge paneli: devir saati (kırmızı bölge işaretli), hız, vites, su sıcaklığı,
yağ basıncı, basınç, EGT, lambda, debriyaj ısısı ve ikaz lambaları (stall, rev
limit, patinaj, el freni, vuruntu, yağ, hararet).

Doğrulama: Supra 0-100 km/s **6.3 s**, Civic Type R **7.2 s**, frenleme
**−10.4 m/s²** (1.06 g). Kalkışta çekiş kuvveti tam olarak lastik tutunma
sınırında kalıyor, fazlası patinaja gidiyor.

### Ses

Hazır kayıt yok. Ses, ateşleme frekansından sentezleniyor:

- **Egzoz darbesi** — üstel azalan harmonik serisinden üretilen bir darbe
  dizisi. Testere dişi veya kare dalga "sentezleyici" gibi duyulur; motor sesi
  sürekli bir ton değil, ayrı ayrı basınç darbeleridir.
- **Mimariye göre harmonikler** — V8'in yarım mertebesi (cross-plane çıtırtısı),
  I4'ün 2. mertebe baskınlığı, V12'nin yoğun üst harmonikleri ayrı ayarlanır.
- **Katmanlar** — egzoz ugultusu, emme hornu, yol/rüzgâr, iki bileşenli lastik
  (cıyırtı + sürünme), fren cıvıltısı, turbo ıslığı, blow-off, marş.
- **Egzoz patlamaları** — gaz kesmede, isteğe bağlı.

### Animasyon

Animasyon **uydurma değil** — çözücünün hesapladığı çevrim izinden sürülüyor.
Ekranda gördüğünüz piston konumu krank kinematiğinin kapalı form çözümü, supap
kalkışı kam profili, alev yarıçapı Wiebe yanmış kütle fraksiyonu, gaz rengi
gerçek silindir içi sıcaklık, ok boyları gerçek kütle debisidir.

Dört katman ayrı açılıp kapanabilir:

- **Yanma** — bujiden yayılan alev cephesi, yanmış/yanmamış bölge ayrımı.
  Vuruntu integrali yükseldikçe son gaz bölgesi kırmızıya döner; otomatik
  tutuşma tam olarak orada olur.
- **Supaplar** — kalkış animasyonu, akış yönü okları (geri akış kırmızı),
  bindirme anında her iki supabın açık olduğu vurgulanır.
- **Kuvvetler** — biyel açısı, etek yan kuvveti vektörü, TDC ve avans ışınları.
- **Termal** — gaz sıcaklığının renk olarak gösterimi, basınç yoğunluğu.

Alttaki **çoklu silindir** görünümü mimariye sadıktır: V ve boxer motorlarda iki
banka ortak krank merkezini paylaşır. Her silindir kendi ateşleme fazında
olduğundan V8'in cross-plane krankı, boxer'ın karşılıklı hareketi ve I6'nın 120°
dizilimi bir bakışta ayırt edilir.

---

## Modellenen fizik

**Termodinamik**
- NASA 7-terimli polinomlar (Gordon & McBride) — sıcaklığa bağlı gerçek cp/cv.
  Sabit `γ=1.4` kestirmesi yok; 2500 K'de γ 1.25'e düşer ve bu genişleme işini
  %8-10 etkiler.
- Su-gaz kayması dengesi ile zengin karışım ürünleri (CO, H₂ oluşumu ve buna
  bağlı yanma verimi düşüşü)

**Yanma**
- Metghalchi–Keck laminer alev hızı korelasyonu
- Türbülans yoğunluğu → türbülanslı alev hızı → yanma süresi (elle girilen
  "burn duration" parametresi **yoktur**)
- Wiebe ısı bırakma fonksiyonu

**Vuruntu**

Vuruntu, parametrelerin toplandığı bir "risk puanı" değil. Çevrim boyunca
son gaz bölgesi ayrı izlenir ve her adımda Douaud–Eyzat otomatik tutuşma
integrali biriktirilir:

```
K = ∫ dt / τ(p, T_songaz, RON, λ)
τ ∝ (RON/100)^3.402 · p^(−1.7) · exp(3800/T) · zenginlikDirenci
```

Üsler doğrusal değildir ve bu kasıtlıdır: sıcaklık üstel, basınç kuvvet
yasası, oktan 3.4'üncü kuvvetle girer. Sıcaklığın baskın etken olması bu
yapının doğal sonucudur.

Son gaz sıcaklığını belirleyen zincirin tamamı modellenir: ortam →
kompresör verimi → intercooler → **yakıt buharlaşmasıyla dolgu soğutması**
→ port ısıtması → sıkıştırma → cidar ısı geçişi.

ECU'nun iki savunma hattı vardır ve sırayla devreye girer:

1. **Ateşleme rötarı** — ikili aramayla vuruntu sınırına oturtulur
   (atmosferikte 16°, turboda 24° yetki). Avans hiçbir koşulda TDC
   sonrasına geçmez.
2. **Basınç kesme** — rötar yetmezse wastegate açılır. Hızlı yanan,
   MBT'si zaten düşük modern motorlarda geri çekecek yer olmadığı için bu
   hat devreye girer; model kaybedilen basıncı ayrıca raporlar.

Tam yük zenginleştirmesi de modellenir: yük eşiği aşılınca karışım
smoothstep ile WOT hedefine iner ve basınçla birlikte daha da zenginleşir.
Fazla yakıt buharlaşırken dolgudan gizli ısı çeker — turbo motorlarda
vuruntuyu bastırmanın birincil mekanizması budur.

**Vuruntu riski** ise "sınırlayıcı çalışıyor mu" değil, **savunma payının
ne kadarının tükendiği** demektir: 0.50 tam kalibrasyon sınırında çalışmak
(fabrika motoru için normaldir), 1.00 üzeri rötar ve basınç yetkisinin
bitmesi (gerçek detonasyon). 12 stok motorun hiçbiri fabrika ayarında
uyarı vermez ve bu bir testle kilitlenmiştir.

Kalibrasyon çarpanları (genel ölçek, sıcaklık, basınç, karışım) arayüzden
ayarlanabilir; elde ölçülmüş bir motora uydurmak için.

**Akış**
- Supap kalkış profili, perde alanı ve port boğazı kısıtı
- Sıkıştırılabilir akış (tıkanık/tıkanık olmayan) — geri akış dahil
- Helmholtz emme rezonansı, egzoz karşı basıncı, süpürme

**Isı transferi**
- Woschni korelasyonu, cidar sıcaklıkları ısı akısıyla değişir
- Emme portu ısıtması (NTU yaklaşımı), yakıt buharlaşmasıyla dolgu soğutması
- Son gaz sıcaklığı ayrı izlenir (sıkışma **ve** ısı kaybı) — vuruntuyu bu belirler

**Mekanik**
- Krank kinematiği kapalı form (pim ofseti dahil)
- Bileşen bazlı sürtünme: segman gerginliği, gaz yüklü segman, piston eteği,
  Petroff yatak sürtünmesi, supap mekanizması, yağ pompası, su pompası,
  alternatör, krank yağ çalkalama (windage), körük tahriki
- Yağ viskozitesi sıcaklığa bağlı, yatak yükü ve etek yan kuvveti

**Ortam ve konum**
- Rakımdan barometrik basınç, hazır konum presetleri (Denver, Mexico City,
  Ankara, Erzurum, Pikes Peak, Ölüm Vadisi…)
- Nemin oksijeni seyreltmesi — yoğunluk düzeltmesinden ayrı bir etki
- Yoğunluk-rakım güç faktörü

**Yağlama**
- Yağ basıncı pompa debisi ile yatak sızıntısının dengesinden: `p ∝ devir·μ/c³`
- Yatak boşluğu parametresi — gevşek yatak basıncı küpsel oranda düşürür
- Sommerfeld sayısından minimum yağ film kalınlığı ve aşınma indeksi
- Tahliye valfi, yağ pompası gücü, yağa giden ısı yükü

**Yakıt sistemi**
- Yakıt sıcaklığı → yoğunluk, buhar basıncı (buhar kilidi payı), atomizasyon
  (Sauter ortalama çapı)
- Pompa debi-basınç eğrisi; talep arzı aşınca ray basıncı düşer ve karışım
  **istenmeden fakirleşir** — bu geri besleme çevrime uygulanır

**Termal durum**
- Canlı su ve yağ sıcaklığı (iki kütleli model, termostat, radyatör, fan)
- Soğuk motor: zenginleştirme, yanma verimi düşüşü, artan sürtünme

**Turbo**
- Gerçek kompresör verim adası (basınç oranı × düzeltilmiş debi), surge ve
  choke sınırları
- **Kompresör debi kapasitesi** — sabit geometrili bir turbo hedef basıncı her
  devirde sağlayamaz. Devir yükseldikçe motorun çektiği debi artar; kompresör
  tıkanma hattına dayandığında basınç düşer. Stok turbo motorların gücünün
  kırmızı çizgide değil ondan **önce** tepe yapmasının sebebi budur. Kapasite
  katsayısı altı turbo motorun fabrika tepe güç devrine karşı kalibre edilmiştir
  (`npx tsx test/turbo-cal.ts`, RMS %6.9)
- Çark uç hızı ve şaft gerilme sınırı, turbo devri
- Şaft ataletinden spool kayması (atalet çark çapının 5. kuvvetiyle artar)
- Türbin A/R oranı: küçük → hızlı spool + yüksek karşı basınç
- Türbin giriş sıcaklığı ve gövde dayanım sınırı

**Egzoz manifoldu**
- Log / fabrika döküm / tubular / eşit uzunluk / zoomies / bireysel
- Her biri karşı basıncı, süpürmeyi, ısı tutmayı ve spool devrini ayrı etkiler

---

## Doğruluk — dürüst değerlendirme

| Motor | Model tork | Gerçek | Model güç | Gerçek | Model tepe dev. | Gerçek |
|---|---|---|---|---|---|---|
| Chevrolet LS3 | 587 N·m | 570 N·m | 384 HP | 430 HP | 5750 | 5900 |
| Honda K20A | 201 N·m | 202 N·m | 161 HP | 220 HP | 8600 | 8000 |
| Toyota 2JZ-GTE | 493 N·m | 441 N·m | 333 HP | 320 HP | 6000 | 5600 |
| Subaru EJ257 | 457 N·m | 393 N·m | 303 HP | 305 HP | 6700 | 6000 |
| Nissan RB26DETT | 417 N·m | 368 N·m | 319 HP | 276 HP | 6750 | 6800 |
| Dodge Viper V10 | 803 N·m | 814 N·m | 507 HP | 645 HP | 5750 | 6200 |

**Güvenilir olan:** eğrilerin şekli, parametre değişimlerinin yönü ve
büyüklüğü, motorlar arası karşılaştırma. Kam süresini artırdığınızda düşük devir
torkunun düşmesi, runner'ı uzattığınızda tepe noktasının kayması, E85'e geçince
vuruntu payının açılması — bunların hepsi doğru çıkar.

**Güvenilir olmayan:** mutlak güç rakamı. Özellikle yüksek devirde %20-30 sapma
olur. İki sebebi var:

1. **1D gaz dinamiği yok.** Emme/egzoz borularındaki basınç dalgaları
   toplulaştırılmış bir rezonans modeliyle temsil ediliyor. Gerçek dalga
   etkileri yüksek devirde belirleyici.
2. **Tek bölgeli (single-zone) model.** Taze dolgu ile artık gazın anında
   karıştığı varsayılır; gerçekte tabakalaşma vardır.

İkincil preset verileri (supap çapları, yay basınçları, parça kütleleri, runner
uzunlukları) çoğu motor için yayımlanmadığından çap/strok ve mimariden
ölçeklenmiş **temsilî** değerlerdir. Birincil ölçüler (çap, strok, biyel,
sıkıştırma oranı, kırmızı çizgi) üretici verisidir.

**Vuruntu kalibrasyonu:** Douaud–Eyzat korelasyonu doğru eğilimi verir ama
mutlak eşiği uygulamaya göre ölçeklenmelidir. Ölçek katsayısı (2.37) sekiz
bilinen motorun fabrika tam gaz avansına karşı ölçülerek belirlenmiştir;
`npx tsx test/knock-cal.ts` ile yeniden üretilebilir.

---

## Mimari

```
src/core/           Fizik çekirdeği — arayüzden tamamen bağımsız
  types.ts            Tip tanımları ve birim politikası (içeride her şey SI)
  gas.ts              NASA polinomları, karışım özellikleri, sıkıştırılabilir akış
  geometry.ts         Krank kinematiği, hacim, kuvvetler
  valve.ts            Kam profili, akış alanı, zamanlama
  combustion.ts       Wiebe, alev hızı, vuruntu
  heat.ts             Woschni, cidar sıcaklıkları
  friction.ts         Bileşen bazlı sürtünme
  induction.ts        Turbo, intercooler, emme ayarı, egzoz
  fuel.ts             Yakıt kimyası (AFR formülden hesaplanır)
  lubrication.ts      Yağ basıncı, film kalınlığı, aşınma
  coolingSystem.ts    Canlı su/yağ sıcaklığı, termostat, radyatör
  drivetrain.ts       Debriyaj, vites kutusu, lastik, araç dinamiği
  driverModel.ts      Pedal dinamiği, otomatik debriyaj, marş mantığı
  cycle.ts            ANA ÇÖZÜCÜ — krank açısı entegrasyonu
  sweep.ts            RPM süpürmesi, statik özellikler, tork haritası
  fuelmap.ts          Harita üretimi ve tablo işlemleri
  presets.ts          Motor kütüphanesi

src/ui/             React arayüzü (çizim, ses, paneller)
test/               204 test
```

Çekirdek, arayüzden hiçbir şey import etmez. `src/core`'u alıp Node.js'te, bir
sunucuda veya başka bir arayüzle kullanabilirsiniz.

---

## Testler

```bash
npm test
```

**99 fizik testi** — her beklenen değer ya literatürden ya da elle yapılabilir
bir hesaptan gelir; kaynağı yorumda belirtilmiştir. Havanın 300 K'deki
cp'sinden Wiebe eğrisinin karakteristik noktalarına, tıkanık akışın analitik
çözümünden zengin karışımın termodinamik verim tavanına kadar.

**56 vuruntu ve turbo testi** — 12 stok motorun hiçbiri fabrika ayarında uyarı
vermemeli; düşük oktan / yüksek basınç / fakir karışım vuruntuyu artırmalı,
zengin karışım ve iyi intercooler azaltmalı; rötar yetkisi tükendiğinde ECU
basıncı kesmeli; avans hiçbir koşulda TDC sonrasına geçmemeli.

**49 sürüş ve ses testi** — otomatik debriyaj, marş zamanlaması, dönen parça
fazları, termal ısınma, ses parametrelerinin geçerliliği.

Testler geliştirme sırasında bulunan ve **sessizce yanlış sonuç üreten**
hataların geri gelmesini engeller — entalpi/iç enerji datum tutarlılığı
(`h − u = R·T`), yanma zamanlaması, artık gaz ölçüm noktası gibi.

---

## Yeni motor eklemek

`src/core/presets.ts` içindeki `PRESET_SPECS` dizisine bir kayıt ekleyin.
Birincil ölçüleri (çap, strok, biyel, CR, supap, kam, kırmızı çizgi) verin;
yay basıncı, atalet ve yatak çapları gibi ikincil değerler `buildEngine`
tarafından fiziksel kurallarla otomatik ölçeklenir.

---

## Katkı

Hata bildirimi ve öneri için
[issue açabilirsiniz](https://github.com/hexdevp/motorsimulasyon/issues).
Fizik modeliyle ilgili bir düzeltme öneriyorsanız, mümkünse kaynağını da
belirtin — çekirdekteki her korelasyonun bir referansı var.

---

<div align="center">

## English

**A crank-angle-resolved internal combustion engine simulator that runs in your
browser.** No install, no account, no server.

### [▶ Live demo](https://hexdevp.github.io/motorsimulasyon/)

</div>

This is not a curve fitter. For every operating point the thermodynamic cycle is
solved over 720° in 0.5° steps, integrating energy conservation at each step.
Torque is the *result* of the cycle, not an input to it.

There is no "burn duration" input box, because burn duration is derived from
flame speed — which itself depends on mixture, temperature, pressure and
turbulence. Increase cam duration and the model *calculates* why low-end torque
drops.

**What's modelled:** NASA 7-term thermodynamic polynomials, water-gas shift
equilibrium for rich mixtures, Metghalchi–Keck laminar flame speed, Wiebe heat
release, a crank-resolved Douaud–Eyzat knock integral over a separately tracked
end-gas zone (with charge cooling from fuel vaporisation, load-dependent
enrichment, ignition retard and knock-driven boost cut), Woschni heat transfer, compressible valve
flow with reverse flow, Helmholtz intake resonance, component-level friction
(Petroff bearings, ring tension, windage), oil pressure from pump/leakage
equilibrium, compressor efficiency islands with surge and choke limits, live
coolant and oil thermal masses, and a full drivetrain from clutch to tyre.

**12 engine presets** (2JZ-GTE, LS3, K20A, EJ257, B58, RB26DETT, Coyote, Barra,
EA888, Viper V10, Ferrari F140 V12, 4A-GE) with ~60 editable parameters each,
a real-time driving mode with synthesised engine audio, a live 2D cylinder
animation driven by the actual solver trace, and a fuel map editor that behaves
like real calibration software.

**Honest about limits:** absolute power is 20-30% off at high rpm — there is no
1D gas dynamics and the model is single-zone. Curve shapes, parameter
sensitivities and engine-to-engine comparisons are reliable. See the accuracy
section above for the full accounting.

UI is available in Turkish and English. Desktop only — the driving tab needs a
keyboard.

```bash
npm install && npm run dev     # develop
npm run build                  # → dist/index.html, a single self-contained file
npm test                       # 204 tests
```
