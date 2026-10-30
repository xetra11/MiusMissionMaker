# Katalog

Automatisch erzeugt mit `node tools/scenario.js catalog`. Nicht von Hand bearbeiten.

## Basen (Kartenausschnitt und Spielerseite)

| `base` | Spieler | Gegner | Kartenausschnitt | Punkte aus dem Originalskript (x, z) |
|---|---|---|---|---|
| `sm01` | USSR | GER | MgG4_Mius | alied (717, 575), mortars (1136, 1532), spotter (1213, 1053), enemy (2163, 533), target (1214, 565), defence (1328, 622), village (1279, 362) |
| `tr01` | USSR | GER | MgE2_Mius | user (1680, 2463), base1 (1927, 2511), base2 (1864, 2507), base3 (1792, 2493), move1 (1658, 2128), enemy (329, 1577), hunt1 (1652, 1765), hunt2 (700, 1841) |
| `tr02` | USSR | GER | MgE2_Mius | ridge (475, 2030), user (-268, 2190), edefence (1384, 1720), at_guns (1233, 1226) |
| `tr03` | GER | USSR | MgI4_Mius | user (488, -877), user1 (488, -877), ambush (590, -192), recon (2573, -47), enemy1 (2735, -664), enemy2 (2995, 324), enemy3 (2350, -150), hill (1841, -177), target (554, -659), return (740, -114), attack (1305, -381) |
| `tr04` | GER | USSR | MgE4_Mius | plc (-883, -690), plc_red (-848, -818), hidden_red (-882, -750), hidden_orange (-912, -750), hidden_yellow (-335, -302), hidden_green (-145, -238), notr (-654, -398), notec (-848, -884), bad (-910, -406), en_plc (143, -112), enemy1 (224, -910), target (-686, -651), attack (0, -845), hill (26, -816), guns (-594, -655), gun1 (-594, -655), inf (-401, -716), pl_inf (-401, -716), pl_sup (-531, -722) |
| `tr05` | USSR | GER | MgI2_Mius | user (465, 2415), arty (208, 2383), mg (234, 2447), enemy (910, 1293), ambush (382, 2446), point0 (334, 2530), point1 (508, 2215), point2 (582, 2089), target (32, 3068) |
| `tr06` | GER | USSR | MgF4_Mius | user (-113, -558), cmd (-113, -558), enemy (1264, -785) |

## Zugtypen Deutsch (GER)

`unit` ohne Zusatz nimmt die staerkste Variante; eine bestimmte Variante waehlt man mit `unit@mission`.

| `unit` | Symbol | Gruppen | Mann | Fahrzeuge/Waffen | Gruppentypen | Varianten (Mann) |
|---|---|---|---|---|---|---|
| `wer_mar_43_plat` | pl_marder2 | 2 | 7 | 1x marder3_139, 1x marder2_131 | 1x wer_marder3_com, 1x wer_marder2 | **`wer_mar_43_plat@sm01` (7)** |
| `wer_mibn_1141_comcoy` | plu_field_com | 5 | 24 | 2x opel_blitz_36, 1x pzb41 | 1x wer_com_inf_coy, 1x wer_squad_phone_mot_rad, 1x wer_squad_atr, 1x wer_pzb41, 1x wer_opel36 | `wer_mibn_1141_comcoy@sm01` (11)<br>`wer_mibn_1141_comcoy@tr04` (23)<br>**`wer_mibn_1141_comcoy@tr05` (24)** |
| `wer_mibn_1141_plat` | plu_rifles | 6 | 50 | - | 1x wer_com_inf_plat, 4x wer_squad_inf_41l, 1x wer_grw36 | **`wer_mibn_1141_plat@sm01` (50)**<br>`wer_mibn_1141_plat@tr02` (27)<br>`wer_mibn_1141_plat@tr04` (50)<br>`wer_mibn_1141_plat@tr05` (47) |
| `wer_spg_bn_43_spam` | plu_spam | 2 | 8 | 2x opel_blitz_36 | 1x wer_com_spam, 1x wer_squad_spam | **`wer_spg_bn_43_spam@tr01` (8)** |
| `wer_mibn_1141_at_plat` | pl_pak40 | 2 | 10 | 1x pak38 | 1x wer_com_art_batm, 1x wer_pak38 | **`wer_mibn_1141_at_plat@tr02` (10)** |
| `wer_mar_42_plat` | pl_marder2 | 4 | 14 | 1x marder2_132, 2x marder3_139, 1x sdkfz250a1 | 1x wer_marder2_com, 2x wer_marder3, 1x wer_sdkfz250a_1 | **`wer_mar_42_plat@tr03` (14)** |
| `wer_minf1141_igcoy_lfpl` | pl_leig | 5 | 25 | 2x leig18 | 1x wer_com_art_batm, 1x wer_squad_phone, 1x wer_com_art_plat, 2x wer_leig18 | **`wer_minf1141_igcoy_lfpl@tr04` (25)** |
| `wer_pz_coy_plat1` | pl_pz3l | 4 | 20 | 1x pz3jlg, 3x pz3m | 1x wer_pz3_com, 3x wer_pz3 | **`wer_pz_coy_plat1@tr06` (20)** |

## Zugtypen Sowjetisch (USSR)

`unit` ohne Zusatz nimmt die staerkste Variante; eine bestimmte Variante waehlt man mit `unit@mission`.

| `unit` | Symbol | Gruppen | Mann | Fahrzeuge/Waffen | Gruppentypen | Varianten (Mann) |
|---|---|---|---|---|---|---|
| `ra_cr_0143_mt82_com` | plu_batcmd | 2 | 10 | - | 1x rkka_com_art_bat, 1x rkka_squad_phone | **`ra_cr_0143_mt82_com@sm01` (10)** |
| `ra_cr_0143_mt82_fplat` | plu_mortars | 4 | 17 | 3x mt82 | 1x rkka_com_art_fplat, 3x rkka_mt82 | **`ra_cr_0143_mt82_fplat@sm01` (17)** |
| `ra_ssq_0143_comsq` | plu_commander | 2 | 10 | - | 1x rkka_com_cav_coy, 1x rkka_squad_phone | **`ra_ssq_0143_comsq@sm01` (10)** |
| `ra_ssq_0143_atr` | plu_atrs | 4 | 18 | - | 1x rkka_com_cav_plat, 3x rkka_squad_cav_atr | **`ra_ssq_0143_atr@sm01` (18)** |
| `ra_ssq_0143_plat` | plu_cavalary | 3 | 17 | - | 1x rkka_com_cav_plat, 2x rkka_squad_cav_43a | **`ra_ssq_0143_plat@sm01` (17)** |
| `ra_tbr_42_bn1_t34_plat` | pl_t34_42 | 3 | 12 | 3x t34_utz_m42_late | 1x rkka_mtank_com, 2x rkka_mtank | `ra_tbr_42_bn1_t34_plat@tr01` (4)<br>**`ra_tbr_42_bn1_t34_plat@tr03` (12)**<br>`ra_tbr_42_bn1_t34_plat@tr06` (12) |
| `ra_rbn_1242_plat2` | plu_rifles | 5 | 39 | - | 1x rkka_com_inf_plat, 2x rkka_squad_inf_43a, 2x rkka_squad_inf_43a2 | `ra_rbn_1242_plat2@tr02` (21)<br>**`ra_rbn_1242_plat2@tr04` (39)** |
| `ra_ogvtpp_42_plat` | pl_kv1s | 2 | 10 | 1x kv1se, 1x kv1s | 1x rkka_htank_com, 1x rkka_htank | **`ra_ogvtpp_42_plat@tr02` (10)** |
| `ra_rr1242_smg_hq` | plu_field_com | 1 | 3 | - | 1x rkka_com_inf_coy | **`ra_rr1242_smg_hq@tr03` (3)** |
| `ra_rr1242_smg_plat` | plu_smg | 4 | 33 | - | 1x rkka_com_smg_plat, 3x rkka_squad_smg_43a | **`ra_rr1242_smg_plat@tr03` (33)** |
| `ra_tbr_42_bn1_t34_cc` | plu_tankcmd | 1 | 4 | 1x t34_utz_m42_late | 1x rkka_mtank_ccom | **`ra_tbr_42_bn1_t34_cc@tr03` (4)** |
| `ra_rbn_1242_comcoy` | plu_field_com | 2 | 5 | - | 1x rkka_com_inf_coy, 1x rkka_squad_sniper | **`ra_rbn_1242_comcoy@tr04` (5)** |
| `ra_tbr_42_bn2_sm_plat` | pl_t70 | 3 | 6 | 3x t70m | 1x rkka_ltank_com, 2x rkka_ltank | **`ra_tbr_42_bn2_sm_plat@tr04` (6)** |
| `ra_rr1242_foot_scout` | plu_scouts | 5 | 41 | - | 1x rkka_com_scout_plat, 3x rkka_squad_scout_43a, 1x rkka_corr_art | **`ra_rr1242_foot_scout@tr05` (41)** |
| `ra_rbn_1242_combat` | plu_commander | 2 | 12 | - | 1x rkka_com_inf_bat, 1x rkka_squad_phone | **`ra_rbn_1242_combat@tr05` (12)** |
| `ra_rbn_1242_hmg` | pl_maxim | 1 | 6 | - | 1x rkka_maxim | **`ra_rbn_1242_hmg@tr05` (6)** |
