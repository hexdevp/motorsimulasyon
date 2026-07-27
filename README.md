# Motor Simülasyonu

Krank-açısı çözünürlüklü 0D içten yanmalı motor simülatörü. Tarayıcıda çalışır,
kurulum gerektirmez, iki dillidir (TR/EN).

---

## Çalıştırma

**Hazır dosyayı açmak** (arkadaşına göndereceğin hâli):

`MotorSimulasyonu.bat` dosyasına çift tıkla. Ya da doğrudan `dist/index.html`
dosyasını tarayıcıda aç. Kurulum, sunucu veya internet gerekmez — her şey tek
bir 256 KB'lık HTML dosyasının içindedir.

**Kaynaktan derlemek:**

```bash
npm install
npm run build
```

**Geliştirme sunucusu:**

```bash
npm run dev
```

**Testler:**

```bash
npm test
```

---

## Web'de yayınlama

Uygulama **tamamen statiktir** — sunucu, veritabanı veya API yoktur.
Derleme çıktısı her şeyi içine gömülmüş tek bir HTML dosyasıdır
(~360 KB, gzip ~118 KB). Bu yüzden herhangi bir statik barındırmada
çalışır ve çalışma zamanı maliyeti yoktur.

### Seçenek A — GitHub Pages (tek hesap yeter)

Depo `.github/workflows/deploy.yml` ile birlikte gelir. `main` dalına her
push'ta: bağımlılıkları kurar, **135 testi çalıştırır**, derler ve yayınlar.
Testler başarısız olursa yayın yapılmaz — bozuk bir fizik modeli siteye
çıkamaz.

**Terminal bilmiyorsan:** klasördeki `GitHubaYukle.bat` dosyasına çift tıkla.
Kullanıcı adını, ismini ve e-postanı sorar, gerisini kendi yapar. Sonraki
güncellemeler için `GuncelleVeYayinla.bat` yeterli.

**Terminalden yapmak istersen:**

```bash
git remote add origin https://github.com/KULLANICI/motorsimulasyon.git
git push -u origin main
```

Her iki durumda da son adım: depoda **Settings → Pages → Source: GitHub
Actions** seçmek. Adres: `https://KULLANICI.github.io/motorsimulasyon/`

### Seçenek B — Vercel (daha hızlı CDN, otomatik önizleme)

`vercel.json` hazırdır; Vercel projeyi Vite olarak tanır. GitHub deposunu
Vercel'e bağlamak yeterlidir — her push otomatik yayınlanır, her dal için
ayrı önizleme adresi üretilir.

Adres: `https://motorsimulasyon.vercel.app` (veya özel alan adı)

### Not

Arayüz masaüstü için tasarlanmıştır: sürüş klavye ile kontrol edilir
(W/S/C/Shift/E/Q/Space/R) ve paneller geniş ekrana göre yerleşir. Telefonda
açılır ama sürüş sekmesi klavye gerektirir.

---

## Ne yapıyor

| Sekme | İçerik |
|---|---|
| **Motor Kurulumu** | 12 hazır motor + ~60 parametrenin tamamı düzenlenebilir |
| **Animasyon** | Canlı 2D silindir kesiti + çoklu silindir görünümü (aşağıda) |
| **Güç & Tork** | RPM süpürmesi, tork/güç/VE/avans/basınç eğrileri, detay tablosu |
| **Silindir İçi** | P-V diyagramı, basınç ve sıcaklık izi, ısı bırakma, supap kalkışı |
| **Yakıt Haritası** | MAP × RPM ızgarası — darbe genişliği, VE, avans, lambda, doluluk |
| **Teşhis** | Durum kontrolü, kök-neden analizi, enerji dengesi, sürtünme dökümü |
| **Sürüş** | Araç içinde gerçek zamanlı sürüş — gösterge paneli ve aktarma şeması |
| **Canlı Sim** | Gaz pedalı, atalet ile gerçek zamanlı devir, göstergeler, rev limiter |
| **Analiz Raporu** | Statik özellikler + devir tablosu + değerlendirme, Markdown çıktı |

### Sürüş sekmesi

Motor artık dinamometrede değil, bir aracın içinde. Her motorun eşleştiği bir
araç var (2JZ → Supra, LS3 → Corvette, K20A → Civic Type R…) ve zincirin
tamamı modelleniyor: motor → debriyaj → vites kutusu → şaft → diferansiyel →
tekerlek → yol.

**Tuşlar:** `W` gaz · `S` fren · `Shift` debriyaj · `E` vites yukarı ·
`Q` vites aşağı · `Space` el freni · `R` motoru çalıştır

Pedallar ani değil kademeli hareket eder — debriyajı yavaş bırakabilmeyi ve
gerçek pedal hissini veren şey budur.

Modelin kritik tarafı zincirin her yerinde **ayrılabilir** olması: debriyaj
kayabilir (ve ısınır), lastik patinaj yapabilir, vites boşta olabilir, motor
stall edebilir. Şema bunların hepsini canlı gösterir — güç akış oklarının
kalınlığı o an geçen torka göre değişir, motor freninde yön tersine döner.

Gösterge paneli: devir saati (kırmızı bölge işaretli), hız, vites, su
sıcaklığı, yağ basıncı, basınç, EGT, lambda, debriyaj ısısı ve ikaz lambaları
(stall, rev limit, patinaj, el freni, vuruntu, yağ, hararet).

Doğrulama: Supra 0-100 km/s **6.3 s**, Civic Type R **7.2 s**, frenleme
**−10.4 m/s²** (1.06 g). Kalkışta çekiş kuvveti tam olarak lastik tutunma
sınırında kalıyor ve fazlası patinaja gidiyor.

### Teşhis sekmesi

İki ayrı soruya cevap verir. **Durum kontrolü** her kalemi ölçülen değer ve
sınırıyla birlikte listeler (enjektör doluluğu, vuruntu payı, piston hızı,
supap yüzme payı, yakıt sistemi payı, yağ basıncı, yağ filmi, yatak yükü,
kompresör verimi, surge payı, uç hızı, türbin sıcaklığı, karşı basınç, EGT,
buhar kilidi payı, motor sıcaklığı) — en kritik olan üstte.

**Kök-neden analizi** tahmin değil hesaplama: vuruntuyu tetikleyen her etkenin
payı, otomatik tutuşma gecikmesini ne kadar kısalttığından çıkarılır. Güç
kaybı da aynı şekilde beygir cinsinden ayrıştırılır. **Enerji dengesi**
yakıtın enerjisinin nereye gittiğini gösterir; sürtünme dökümü her mekanik
kalemi ayrı ayrı HP olarak verir.

### Animasyon sekmesi

Animasyon **uydurma değil** — çözücünün hesapladığı çevrim izinden sürülür.
Ekranda gördüğün piston konumu krank kinematiğinin kapalı form çözümü, supap
kalkışı kam profili, alev yarıçapı Wiebe yanmış kütle fraksiyonu, gaz rengi
gerçek silindir içi sıcaklık, ok boyları gerçek kütle debisidir.

Dört katman ayrı ayrı açılıp kapanabilir:

- **Yanma** — bujiden yayılan alev cephesi, yanmış/yanmamış bölge ayrımı.
  Vuruntu integrali yükseldikçe son gaz bölgesi kırmızıya döner; otomatik
  tutuşma tam olarak orada olur.
- **Supaplar** — kalkış animasyonu, akış yönü okları (geri akış/reversion
  kırmızı çizilir), bindirme anında her iki supabın açık olduğu vurgulanır.
- **Kuvvetler** — biyel açısı, etek yan kuvveti vektörü (hangi tarafa
  bastığı), TDC ve ateşleme avansı ışınları.
- **Termal** — gaz sıcaklığının renk olarak gösterimi, basınç yoğunluğu.

Yanında P-V diyagramı, basınç izi ve supap kalkış grafiği animasyonla senkron
koşar. Krank açısı çubuğuyla istediğin ana kaydırıp inceleyebilirsin.

Alttaki **çoklu silindir** görünümü mimariye sadıktır: V ve boxer motorlarda
iki banka ortak krank merkezini paylaşır, sıralı motorlarda silindirler yan
yana dizilir. Her silindir kendi ateşleme fazında olduğundan V8'in cross-plane
krankı, boxer'ın karşılıklı hareketi ve I6'nın 120° dizilimi bir bakışta
ayırt edilir. Ateşleme sırası ve aralığı üstte yazılıdır.

Fuel map ızgarası gerçek kalibrasyon yazılımları gibi çalışır: tıkla-sürükle
seçim, ok tuşlarıyla gezinme, doğrudan değer yazma, `Ctrl+C`/`Ctrl+V` ile
Excel'e taşıma, seçili bölgeye `=` `+` `×` `%` işlemleri, yatay/dikey ara değer
hesabı ve yumuşatma.

---

## Modellenen fizik

Bu bir eğri uydurma değil; her çevrim 720° boyunca 0.5° adımlarla enerji
korunumu entegre edilerek çözülür.

**Termodinamik**
- NASA 7-terimli polinomlar (Gordon & McBride) — sıcaklığa bağlı gerçek cp/cv.
  Sabit `γ=1.4` kestirmesi yok; 2500 K'de γ 1.25'e düşer ve bu genişleme işini
  %8-10 etkiler.
- Su-gaz kayması dengesi ile zengin karışım ürünleri (CO, H₂ oluşumu ve buna
  bağlı yanma verimi düşüşü)

**Yanma**
- Metghalchi–Keck laminer alev hızı korelasyonu
- Türbülans yoğunluğu → türbülanslı alev hızı → yanma süresi (elle girilen
  "burn duration" parametresi **yoktur**, alev hızından türetilir)
- Wiebe ısı bırakma fonksiyonu
- Douaud–Eyzat otomatik tutuşma modeli ile vuruntu integrali

**Akış**
- Supap kalkış profili, perde alanı ve port boğazı kısıtı
- Sıkıştırılabilir akış (tıkanık/tıkanık olmayan) — geri akış dahil
- Helmholtz emme rezonansı, egzoz karşı basıncı, süpürme

**Isı transferi**
- Woschni korelasyonu, cidar sıcaklıkları ısı akısıyla birlikte değişir
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
- Yakıt sıcaklığı → yoğunluk (enjektör kütlesel debisi), buhar basıncı
  (buhar kilidi payı), atomizasyon (Sauter ortalama çapı)
- Pompa debi-basınç eğrisi; talep arzı aşınca ray basıncı düşer ve karışım
  **istenmeden fakirleşir** — bu geri besleme çevrime uygulanır

**Termal durum**
- Soğutma suyu sıcaklığından ısınma faktörü: zenginleştirme, yanma verimi
  düşüşü, artan sürtünme, port ısıtmasının azalması

**Turbo**
- Gerçek kompresör verim adası (basınç oranı × düzeltilmiş debi), surge ve
  choke sınırları
- Çark uç hızı ve şaft gerilme sınırı, turbo devri
- Şaft ataletinden spool kayması (atalet çark çapının 5. kuvvetiyle artar)
- Türbin A/R oranı: küçük → hızlı spool + yüksek karşı basınç
- Türbin giriş sıcaklığı ve gövde dayanım sınırı, yatak ısı yükü

**Egzoz manifoldu**
- Log / fabrika döküm / tubular / eşit uzunluk / zoomies / bireysel
- Her biri karşı basıncı, süpürmeyi, ısı tutmayı ve spool devrini ayrı etkiler

---

## Doğruluk — dürüst değerlendirme

Model, gerçek motorlarla karşılaştırıldığında:

| Motor | Model tork | Gerçek | Model güç | Gerçek |
|---|---|---|---|---|
| Chevrolet LS3 | 565 N·m | 570 N·m | 385 HP | 430 HP |
| Honda K20A | 188 N·m | 202 N·m | 163 HP | 220 HP |
| Toyota 2JZ-GTE | 508 N·m | 441 N·m | 411 HP | ~320 HP |

**Güvenilir olan:** eğrilerin şekli, parametre değişimlerinin yönü ve
büyüklüğü, motorlar arası karşılaştırma. Kam süresini artırdığında düşük devir
torkunun düşmesi, runner'ı uzattığında tepe noktasının kayması, E85'e geçince
vuruntu payının açılması — bunların hepsi doğru çıkar.

**Güvenilir olmayan:** mutlak güç rakamı. Özellikle yüksek devirde %20-30
düşük tahmin edilir. İki sebebi var:

1. **1D gaz dinamiği yok.** Emme/egzoz borularındaki basınç dalgaları
   toplulaştırılmış bir rezonans modeliyle temsil ediliyor. Gerçek dalga
   etkileri yüksek devirde belirleyici.
2. **Tek bölgeli (single-zone) model.** Taze dolgu ile artık gazın anında
   karıştığı varsayılır; gerçekte tabakalaşma vardır ve bu, hesaplanan dolgu
   sıcaklığını olduğundan yüksek gösterip hacimsel verimi bir miktar düşürür.

İkincil preset verileri (supap çapları, yay basınçları, parça kütleleri,
runner uzunlukları) çoğu motor için yayımlanmadığından çap/strok ve mimariden
ölçeklenmiş **temsilî** değerlerdir. Birincil ölçüler (çap, strok, biyel,
sıkıştırma oranı, kırmızı çizgi) üretici verisidir.

**Vuruntu modeli kalibrasyonu:** Douaud–Eyzat korelasyonu doğru eğilimi verir
ama mutlak eşiği uygulamaya göre ölçeklenmelidir. Ölçek katsayısı (2.37) sekiz
bilinen motorun fabrika tam gaz avansına karşı ölçülerek belirlenmiştir;
`npx tsx test/knock-cal.ts` ile yeniden üretilebilir.

---

## Dosya yapısı

```
src/core/           Fizik çekirdeği — arayüzden tamamen bağımsız, test edilebilir
  types.ts            Tip tanımları ve birim politikası (içeride her şey SI)
  gas.ts              NASA polinomları, karışım özellikleri, sıkıştırılabilir akış
  geometry.ts         Krank kinematiği, hacim, kuvvetler
  valve.ts            Kam profili, akış alanı, zamanlama
  combustion.ts       Wiebe, alev hızı, vuruntu
  heat.ts             Woschni, cidar sıcaklıkları
  friction.ts         Bileşen bazlı sürtünme
  induction.ts        Turbo, intercooler, emme ayarı, egzoz
  fuel.ts             Yakıt kimyası (AFR formülden hesaplanır)
  cycle.ts            ANA ÇÖZÜCÜ — krank açısı entegrasyonu
  sweep.ts            RPM süpürmesi, statik özellikler, tork haritası
  fuelmap.ts          Harita üretimi ve tablo işlemleri
  presets.ts          Motor kütüphanesi

src/ui/             React arayüzü
test/               Fizik doğrulama (99 test) ve tanılama betikleri
```

Çekirdek, arayüzden hiçbir şey import etmez. İstersen `src/core`'u alıp
Node.js'te, bir sunucuda veya başka bir arayüzle kullanabilirsin.

---

## Yeni motor eklemek

`src/core/presets.ts` içindeki `PRESET_SPECS` dizisine bir kayıt ekle.
Birincil ölçüleri (çap, strok, biyel, CR, supap, kam, kırmızı çizgi) ver;
yay basıncı, atalet ve yatak çapları gibi ikincil değerler `buildEngine`
tarafından fiziksel kurallarla otomatik ölçeklenir.

---

## Test edilenler

`npx tsx test/physics.test.ts` — 99 test. Her beklenen değer ya literatürden
ya da elle yapılabilir bir hesaptan gelir; kaynağı yorumda belirtilmiştir.
Havanın 300 K'deki cp'sinden Wiebe eğrisinin karakteristik noktalarına,
tıkanık akışın analitik çözümünden zengin karışımın termodinamik verim
tavanına kadar.

Testler ayrıca geliştirme sırasında bulunan ve **sessizce yanlış sonuç üreten**
hataların geri gelmesini engeller — özellikle entalpi/iç enerji datum
tutarlılığı (`h − u = R·T`) ve yanma zamanlaması.
