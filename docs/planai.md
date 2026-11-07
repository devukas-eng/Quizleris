# Planai: ką gali kiekviena paskyra

Lentelė lyginimui. Taisyklių šaltinis yra serveris. Plano ribos ir `planCapabilities(user)` yra [`src/backend/plans.js`](../src/backend/plans.js), o banko teisės yra `bankLimits` faile [`src/backend/bank.js`](../src/backend/bank.js). Keičiant taisyklę, kartu pataisyk ir šią lentelę.

Paskyrų rūšys:
- **Nemokamas**: mokytojas be premium.
- **Premium**: `subscription_tier = 'premium'`, galioja iki `subscription_expires_at`. Jei data nenurodyta, galioja visada.
- **Kūrėjas**: banko darbuotojas (`role = 'creator'`). Kaip ir admin, visam laikui turi premium ribas.
- **Admin**: `role = 'admin'`.

Mokiniai paskyros neturi: jie sprendžia testus pagal kodą, o temas laiko naršyklėje.

✓ = gali, ✗ = negali, ∞ = be ribos.

## Testai

| Galimybė | Nemokamas | Premium | Kūrėjas | Admin | Kur tikrinama |
|---|---|---|---|---|---|
| Testų debesyje | 5 | ∞ | ∞ | ∞ | `FREE_QUIZ_LIMIT`, `POST /api/quizzes` |
| Naujas testas laikomas be pratęsimo | 30 d. | visada | visada | visada | `FIRST_DAYS` |
| Po to testą reikia pratęsti (mygtuku „Pratęsti“ arba išsaugant) bent kas | 7 d. | niekada | niekada | niekada | `KEEP_DAYS`, `POST /api/quizzes/:id/keep` |
| Nepratęstas testas sustabdytas, po to ištrinamas visam laikui | 3 d. | – | – | – | `PAUSE_DAYS`, `hourly` faile `src/backend/quiz-trash.js` |
| Ištrintas testas su rezultatais saugomas | 14 d. | 30 d. | 30 d. | 30 d. | `RECOVERY_DAYS`, `src/backend/quiz-trash.js` |
| Ištrinto testo atkūrimas | ✗ | ✓ | ✓ | ✓, ir kitų | `restore_quizzes`, `POST /api/quiz-trash/:id/restore` |
| Saugomos ankstesnės testo versijos | 5 | 30 | 30 | 30 | `VERSIONS_KEPT`, `src/backend/quiz-versions.js` |
| Kelių failų importas vienu metu | ✗ | ✓ | ✓ | ✓ | `import_many`; tikrina tik puslapis, nes importas vyksta naršyklėje |
| Kitų žmonių testų redagavimas ir trynimas | ✗ | ✗ | ✗ | ✓ | `server.js`, `role === 'admin'` |
| Visų testų sąrašas | ✗ | ✗ | ✗ | ✓ | `GET /api/quizzes` |

Nemokamame plane kiekvienas testas, ir viešas, ir privatus, pirmąsias 30 d. nuo sukūrimo laikomas savaime. Nuo 30-os dienos jį reikia pratęsti bent kas 7 d., kaip nemokamuose talpinimo puslapiuose. Išsaugojimas irgi pratęsia. Nepratęstas testas sustabdomas: mokiniai jo neatidaro ir mato, kad mokytojas jo nepratęsė, o mokytojas jį dar mato ir gali pratęsti. Po 3 d. jis su rezultatais ištrinamas visam laikui, nepatekdamas į ištrintus. Admino į vitriną įdėtų testų pratęsti nereikia.

Kai paskyra gauna premium ribas (tampa premium, kūrėju ar admin), kas valandą vykstantis valymas nuima pratęsimo datą nuo jos testų. Kai premium baigiasi, jos testams vėl skaičiuojamas laikas: jaunesniems nei 30 d. iki 30-os dienos, kitiems 7 d.

Ištrintas testas iškart dingsta mokiniams ir neįskaičiuojamas į 5 testų ribą, bet su rezultatais dar saugomas tiek, kiek rodo lentelė. Dienos skaičiuojamos pagal testo savininko planą trynimo metu. Nemokamo plano laukimas yra laikas pereiti į Premium ir testą atkurti. Ištrynus paskyrą, jos testai ištrinami visam laikui iškart.

Versija išsaugoma kiekvieną kartą, kai išsaugojimas ką nors pakeičia. Ankstesnė versija atidaroma redaktoriuje kaip neišsaugoti pakeitimai, todėl ją galima atšaukti, o išsaugojus ji tampa naujausia.

## Temos

| Galimybė | Nemokamas | Premium | Kūrėjas | Admin | Kur tikrinama |
|---|---|---|---|---|---|
| 13 įtaisytų temų, galerija, išbandymas | ✓ | ✓ | ✓ | ✓ | visiems, ir mokiniams |
| Savos temos (iki 20) ir dalinimosi kodai | ✓ naršyklėje | ✓ | ✓ | ✓ | `src/themes.js` |
| Temos išsaugomos paskyroje ir seka į kitus įrenginius | ✗ | ✓ | ✓ | ✓ | `theme_sync`, `/api/me/themes` |

## Užduočių bankas

| Galimybė | Nemokamas | Premium | Kūrėjas | Admin | Kur tikrinama |
|---|---|---|---|---|---|
| Bendro banko skaitymas, užduočių ėmimas į testą | ✓ | ✓ | ✓ | ✓ | `bankLimits().read` |
| Žvaigždutės (iki 2000) | ✓ | ✓ | ✓ | ✓ | `MAX_FAVORITES` |
| Pranešimai apie klaidas (iki 30 laukiančių) | ✓ | ✓ | ✓ | ✓ | `MAX_OPEN_REPORTS` |
| Savas privatus bankas | ✓ | ✓ | ✓ | ✓ | `bankLimits().writeMine` |
| Privataus banko dydis | 10 000 užd., 1000 aplankų | tas pats | be ribos | be ribos | `MAX_PRIVATE_ITEMS`, `MAX_FOLDERS` |
| Bendro banko pildymas ir taisymas | ✗ | ✗ | ✓ | ✓ | `bankLimits().writeShared` |
| Pranešimų apie klaidas peržiūra | ✗ | ✗ | ✓ | ✓ | `requireStaff` |
| Galutinis bendrų užduočių trynimas | ✗ | ✗ | ✗ | ✗ | `archiveItems`, `bank.js`: bendros užduotys tik archyvuojamos |
| Klasifikatoriai (dalykai, klasės, temos, sunkumai) | ✗ | ✗ | ✗ | ✓ | `requireAdmin` |

Bankas premium kol kas nieko daugiau neduoda. Komentaras prie `bankLimits` jau numato vietą premium riboms: šablonų variantams, visos temos parinkimui ir privataus banko dydžiui.

## Paskyros ir administravimas

| Galimybė | Nemokamas | Premium | Kūrėjas | Admin | Kur tikrinama |
|---|---|---|---|---|---|
| Registracijos kodų kūrimas (mokytojo ar kūrėjo) | ✗ | ✗ | ✗ | ✓ | `/api/admin/invites` |
| Vartotojų sąrašas | ✗ | ✗ | ✗ | ✓ | `/api/admin/users` |

## Kaip puslapis sužino ribas

`GET /api/me` grąžina `capabilities`, pvz.:

```json
{ "plan": "premium", "max_quizzes": null, "first_days": null, "keep_days": null, "pause_days": null, "import_many": true, "theme_sync": true,
  "recovery_days": 30, "restore_quizzes": true, "versions_kept": 30 }
```

`plan` reikšmė gali būti `free`, `premium`, `creator` arba `admin`.
