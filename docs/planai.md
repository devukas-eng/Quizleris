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
| Privatus testas ištrinamas po | 30 d. | niekada | niekada | niekada | `PRIVATE_EXPIRY_DAYS` |
| Kelių failų importas vienu metu | ✗ | ✓ | ✓ | ✓ | `import_many`; tikrina tik puslapis, nes importas vyksta naršyklėje |
| Kitų žmonių testų redagavimas ir trynimas | ✗ | ✗ | ✗ | ✓ | `server.js`, `role === 'admin'` |
| Visų testų sąrašas | ✗ | ✗ | ✗ | ✓ | `GET /api/quizzes` |

Kai paskyra gauna premium ribas (tampa premium, kūrėju ar admin), kas valandą vykstantis valymas nuima galiojimo datą nuo jos privačių testų. Taip jie nebeištrinami.

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
| Galutinis bendrų užduočių trynimas | ✗ | ✗ | ✗ | ✓ | `purge`, `bank.js` |
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
{ "plan": "premium", "max_quizzes": null, "private_expiry_days": null, "import_many": true, "theme_sync": true }
```

`plan` reikšmė gali būti `free`, `premium`, `creator` arba `admin`.
