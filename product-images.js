const IMAGE_BASE = "https://99puritywholesale.com/product-images/";

const PRODUCT_IMAGE_FALLBACKS = {
  "retatrutide": IMAGE_BASE + "RETATRUTIDE%2010mg-6.webp",
  "tirzepatide": IMAGE_BASE + "TIRZEPATIDE%2010mg-3.webp",
  "semaglutide": IMAGE_BASE + "SEMAGLUTIDE%205mg-2.webp",
  "5-amino-1mq": IMAGE_BASE + "5-AMINO-1MQ%2050mg.webp",
  "aod-9604": "https://99puritypeptides.com/_next/image?url=https%3A%2F%2Fpub-82f90d490a8048aa9629f0ae3ea6f567.r2.dev%2FProduct%20Images%2FAOD9604%20%205mg.webp&w=1920&q=75",
  "cagrilintide": IMAGE_BASE + "CAGRILINTIDE%2010mg.webp",
  "bpc-157": IMAGE_BASE + "BPC-157%205mg-5.webp",
  "tb-500": IMAGE_BASE + "TB-500%20%205mg-2.webp",
  "bpc-tb-500": "https://99puritypeptides.com/_next/image?url=https%3A%2F%2Fpub-82f90d490a8048aa9629f0ae3ea6f567.r2.dev%2FProduct%20Images%2FBPC-157%20TB-500%20MIX%205mg%205mg-5.webp&w=1920&q=75",
  "kpv": IMAGE_BASE + "KPV%2010mg.webp",
  "ara-290": IMAGE_BASE + "ARA-290%20%2010mg.webp",
  "ll-37": "https://99puritypeptides.com/_next/image?url=https%3A%2F%2Fpub-82f90d490a8048aa9629f0ae3ea6f567.r2.dev%2FProduct%20Images%2FLL37%205mg.webp&w=3840&q=75",
  "thymosin-alpha-1": IMAGE_BASE + "Thymosin%20Alpha%201mg.webp",
  "ghk-cu": IMAGE_BASE + "GHK-CU%2050mg-1.webp",
  "ahk-cu": IMAGE_BASE + "AHK-CU%2050mg-1.webp",
  "glow": IMAGE_BASE + "GLOW%2070mg.webp",
  "klow": IMAGE_BASE + "KLOW.webp",
  "snap8": IMAGE_BASE + "SNAP%208%20%2010mg.webp",
  "cjc-1295-no-dac": IMAGE_BASE + "CJC-1295%20No%20DAC%20%2010mg.webp",
  "cjc-1295-dac": IMAGE_BASE + "CJC%20W%20DAC%20%205mg.webp",
  "cjc-ipamorelin": IMAGE_BASE + "CJC%201295%20IPAMORELIN%205mg%205mg-2.webp",
  "ipamorelin": IMAGE_BASE + "IPAMORELIN%205mg-2.webp",
  "sermorelin": IMAGE_BASE + "SERMORELIN%2010mg.webp",
  "tesamorelin": IMAGE_BASE + "TESAMORELIN%2010mg-1.webp",
  "tesa-ipa": IMAGE_BASE + "TESA%20IPA%206mg%203mg.webp",
  "semax": IMAGE_BASE + "SEMAX%2010mg.webp",
  "selank": IMAGE_BASE + "SELANK%2010mg.webp",
  "semax-selank": IMAGE_BASE + "SEMAX%20SELANK%2010%2010.webp",
  "adamax": IMAGE_BASE + "adamax-5mg.webp",
  "dsip": IMAGE_BASE + "DSIP%2010mg.webp",
  "nad": IMAGE_BASE + "nad-plus-500mg-1.webp",
  "epithalon": IMAGE_BASE + "EPITHALON%2010mg.webp",
  "glutathione": "https://99puritypeptides.com/_next/image?url=https%3A%2F%2Fpub-82f90d490a8048aa9629f0ae3ea6f567.r2.dev%2FProduct%20Images%2FGLUTATHIONE%20%20600mg.webp&w=1920&q=75",
  "ss-31": IMAGE_BASE + "SS-31%2010mg-1.webp",
  "mots-c": IMAGE_BASE + "MOTS-C%2010mg-1.webp",
  "b-12": IMAGE_BASE + "b12-10mg.webp",
  "melanotan-ii": IMAGE_BASE + "MT-2%2010mg.webp",
  "melanotan-1": IMAGE_BASE + "MT-1%2010mg.webp",
  "pt-141": IMAGE_BASE + "PT-141%2010mg.webp",
  "kisspeptin": IMAGE_BASE + "KISSPEPTIN%20%2010mg.webp",
  "vip": IMAGE_BASE + "VIP%2010mg.webp",
  "bac-3": IMAGE_BASE + "BAC%20WATER%203ML.webp",
  "bac-10": IMAGE_BASE + "BAC%20WATER%203ML.webp",
  "needles": "https://99puritypeptides.com/_next/image?url=https%3A%2F%2Fpub-82f90d490a8048aa9629f0ae3ea6f567.r2.dev%2FProduct%20Images%2F10%20Needles-1.webp&w=3840&q=75"
};


// Per-dosage label images copied from ALTA_83_curved_label_photos/product_manifest.csv.
// Unmatched catalog variant retained on its original image fallback: Needles 31G 5/16\" — 10pk (no matching uploaded label).
const PRODUCT_IMAGES = {
  "retatrutide": {
    "10mg": "assets/products/01_retatrutide_10mg.png",
    "15mg": "assets/products/02_retatrutide_15mg.png",
    "20mg": "assets/products/03_retatrutide_20mg.png",
    "30mg": "assets/products/04_retatrutide_30mg.png",
    "40mg": "assets/products/05_retatrutide_40mg.png",
    "60mg": "assets/products/06_retatrutide_60mg.png"
  },
  "tirzepatide": {
    "10mg": "assets/products/07_tirzepatide_10mg.png",
    "20mg": "assets/products/08_tirzepatide_20mg.png",
    "30mg": "assets/products/09_tirzepatide_30mg.png",
    "40mg": "assets/products/10_tirzepatide_40mg.png",
    "60mg": "assets/products/11_tirzepatide_60mg.png"
  },
  "semaglutide": {
    "10mg": "assets/products/12_semaglutide_10mg.png",
    "20mg": "assets/products/13_semaglutide_20mg.png",
    "30mg": "assets/products/14_semaglutide_30mg.png"
  },
  "5-amino-1mq": {
    "10mg": "assets/products/15_5-amino-1mq_10mg.png",
    "50mg": "assets/products/16_5-amino-1mq_50mg.png"
  },
  "aod-9604": {
    "5mg": "assets/products/17_aod-9604_5mg.png",
    "10mg": "assets/products/18_aod-9604_10mg.png"
  },
  "cagrilintide": {
    "5mg": "assets/products/76_cagrilintide_5mg.png",
    "10mg": "assets/products/77_cagrilintide_10mg.png"
  },
  "bpc-157": {
    "5mg": "assets/products/20_bpc-157_5mg.png",
    "10mg": "assets/products/21_bpc-157_10mg.png"
  },
  "tb-500": {
    "5mg": "assets/products/22_tb-500_5mg.png",
    "10mg": "assets/products/23_tb-500_10mg.png"
  },
  "bpc-tb-500": {
    "10mg/10mg": "assets/products/24_bpc_tb-500_10mg_10mg.png",
    "15mg/15mg": "assets/products/25_bpc_tb-500_15mg_15mg.png"
  },
  "kpv": {
    "5mg": "assets/products/27_kpv_5mg.png",
    "10mg": "assets/products/28_kpv_10mg.png"
  },
  "ara-290": {
    "10mg": "assets/products/31_ara-290_10mg.png"
  },
  "ll-37": {
    "5mg": "assets/products/78_ll-37_5mg.png",
    "10mg": "assets/products/79_ll-37_10mg.png"
  },
  "thymosin-alpha-1": {
    "10mg": "assets/products/81_thymosin_alpha-1_10mg.png"
  },
  "ghk-cu": {
    "50mg": "assets/products/64_ghk-cu_50mg.png",
    "100mg": "assets/products/65_ghk-cu_100mg.png"
  },
  "ahk-cu": {
    "50mg": "assets/products/66_ahk-cu_50mg.png",
    "100mg": "assets/products/67_ahk-cu_100mg.png"
  },
  "glow": {
    "70mg": "assets/products/68_glow_70mg.png"
  },
  "klow": {
    "80mg": "assets/products/26_klow_80mg.png"
  },
  "snap8": {
    "10mg": "assets/products/80_snap8_10mg.png"
  },
  "cjc-1295-no-dac": {
    "5mg": "assets/products/32_cjc-1295_no_dac_5mg.png",
    "10mg": "assets/products/33_cjc-1295_no_dac_10mg.png"
  },
  "cjc-1295-dac": {
    "5mg": "assets/products/34_cjc-1295_w_dac_5mg.png",
    "10mg": "assets/products/35_cjc-1295_w_dac_10mg.png"
  },
  "cjc-ipamorelin": {
    "10mg/10mg": "assets/products/36_cjc_ipamorelin_10mg_10mg.png"
  },
  "ipamorelin": {
    "5mg": "assets/products/37_ipamorelin_5mg.png",
    "10mg": "assets/products/38_ipamorelin_10mg.png"
  },
  "sermorelin": {
    "5mg": "assets/products/39_sermorelin_5mg.png",
    "10mg": "assets/products/40_sermorelin_10mg.png"
  },
  "tesamorelin": {
    "10mg": "assets/products/41_tesamorelin_10mg.png",
    "20mg": "assets/products/42_tesamorelin_20mg.png"
  },
  "tesa-ipa": {
    "5mg/5mg": "assets/products/43_tesa_ipa_5mg_5mg.png"
  },
  "semax": {
    "5mg": "assets/products/56_semax_5mg.png",
    "10mg": "assets/products/57_semax_10mg.png"
  },
  "selank": {
    "5mg": "assets/products/58_selank_5mg.png",
    "10mg": "assets/products/59_selank_10mg.png"
  },
  "semax-selank": {
    "10mg/10mg": "assets/products/60_semax_selank_10mg_10mg.png"
  },
  "adamax": {
    "10mg": "assets/products/61_adamax_10mg.png"
  },
  "pinealon": {
    "10mg": "assets/products/55_pinealon_10mg.png"
  },
  "dsip": {
    "5mg": "assets/products/62_dsip_5mg.png",
    "10mg": "assets/products/63_dsip_10mg.png"
  },
  "nad": {
    "500mg": "assets/products/44_nadplus_500mg.png",
    "1000mg": "assets/products/45_nadplus_1000mg.png"
  },
  "epithalon": {
    "10mg": "assets/products/46_epithalon_10mg.png",
    "50mg": "assets/products/47_epithalon_50mg.png"
  },
  "glutathione": {
    "600mg": "assets/products/48_glutathione_600mg.png",
    "1500mg": "assets/products/49_glutathione_1500mg.png"
  },
  "ss-31": {
    "10mg": "assets/products/50_ss-31_10mg.png",
    "50mg": "assets/products/51_ss-31_50mg.png"
  },
  "mots-c": {
    "10mg": "assets/products/52_mots-c_10mg.png",
    "20mg": "assets/products/53_mots-c_20mg.png",
    "40mg": "assets/products/54_mots-c_40mg.png"
  },
  "b-12": {
    "10mg": "assets/products/19_b-12_10mg.png"
  },
  "melanotan-ii": {
    "10mg": "assets/products/69_melanotan_ii_10mg.png"
  },
  "melanotan-1": {
    "10mg": "assets/products/70_melanotan_1_10mg.png"
  },
  "pt-141": {
    "10mg": "assets/products/71_pt-141_10mg.png"
  },
  "kisspeptin": {
    "5mg": "assets/products/72_kisspeptin_5mg.png",
    "10mg": "assets/products/73_kisspeptin_10mg.png"
  },
  "oxytocin": {
    "5mg": "assets/products/74_oxytocin_5mg.png",
    "10mg": "assets/products/75_oxytocin_10mg.png"
  },
  "vip": {
    "5mg": "assets/products/29_vip_5mg.png",
    "10mg": "assets/products/30_vip_10mg.png"
  },
  "bac-3": {
    "3 mL": "assets/products/82_bac_water_3ml.png"
  },
  "bac-10": {
    "10 mL": "assets/products/83_bac_water_10ml.png"
  }
};
