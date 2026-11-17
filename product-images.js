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


// Per-dosage PURE assets use exact catalog text over the original photographic vial framing.
// Needles 31G 5/16\" — 10pk has no matching uploaded photo and retains its existing fallback.
const PRODUCT_IMAGES = {
  "retatrutide": {
    "10mg": "assets/products-pure/01_retatrutide_10mg.svg",
    "15mg": "assets/products-pure/02_retatrutide_15mg.svg",
    "20mg": "assets/products-pure/03_retatrutide_20mg.svg",
    "30mg": "assets/products-pure/04_retatrutide_30mg.svg",
    "40mg": "assets/products-pure/05_retatrutide_40mg.svg",
    "60mg": "assets/products-pure/06_retatrutide_60mg.svg"
  },
  "tirzepatide": {
    "10mg": "assets/products-pure/07_tirzepatide_10mg.svg",
    "20mg": "assets/products-pure/08_tirzepatide_20mg.svg",
    "30mg": "assets/products-pure/09_tirzepatide_30mg.svg",
    "40mg": "assets/products-pure/10_tirzepatide_40mg.svg",
    "60mg": "assets/products-pure/11_tirzepatide_60mg.svg"
  },
  "semaglutide": {
    "10mg": "assets/products-pure/12_semaglutide_10mg.svg",
    "20mg": "assets/products-pure/13_semaglutide_20mg.svg",
    "30mg": "assets/products-pure/14_semaglutide_30mg.svg"
  },
  "5-amino-1mq": {
    "10mg": "assets/products-pure/15_5-amino-1mq_10mg.svg",
    "50mg": "assets/products-pure/16_5-amino-1mq_50mg.svg"
  },
  "aod-9604": {
    "5mg": "assets/products-pure/17_aod-9604_5mg.svg",
    "10mg": "assets/products-pure/18_aod-9604_10mg.svg"
  },
  "cagrilintide": {
    "5mg": "assets/products-pure/76_cagrilintide_5mg.svg",
    "10mg": "assets/products-pure/77_cagrilintide_10mg.svg"
  },
  "bpc-157": {
    "5mg": "assets/products-pure/20_bpc-157_5mg.svg",
    "10mg": "assets/products-pure/21_bpc-157_10mg.svg"
  },
  "tb-500": {
    "5mg": "assets/products-pure/22_tb-500_5mg.svg",
    "10mg": "assets/products-pure/23_tb-500_10mg.svg"
  },
  "bpc-tb-500": {
    "10mg/10mg": "assets/products-pure/24_bpc_tb-500_10mg_10mg.svg",
    "15mg/15mg": "assets/products-pure/25_bpc_tb-500_15mg_15mg.svg"
  },
  "kpv": {
    "5mg": "assets/products-pure/27_kpv_5mg.svg",
    "10mg": "assets/products-pure/28_kpv_10mg.svg"
  },
  "ara-290": {
    "10mg": "assets/products-pure/31_ara-290_10mg.svg"
  },
  "ll-37": {
    "5mg": "assets/products-pure/78_ll-37_5mg.svg",
    "10mg": "assets/products-pure/79_ll-37_10mg.svg"
  },
  "thymosin-alpha-1": {
    "10mg": "assets/products-pure/81_thymosin_alpha-1_10mg.svg"
  },
  "ghk-cu": {
    "50mg": "assets/products-pure/64_ghk-cu_50mg.svg",
    "100mg": "assets/products-pure/65_ghk-cu_100mg.svg"
  },
  "ahk-cu": {
    "50mg": "assets/products-pure/66_ahk-cu_50mg.svg",
    "100mg": "assets/products-pure/67_ahk-cu_100mg.svg"
  },
  "glow": {
    "70mg": "assets/products-pure/68_glow_70mg.svg"
  },
  "klow": {
    "80mg": "assets/products-pure/26_klow_80mg.svg"
  },
  "snap8": {
    "10mg": "assets/products-pure/80_snap8_10mg.svg"
  },
  "cjc-1295-no-dac": {
    "5mg": "assets/products-pure/32_cjc-1295_no_dac_5mg.svg",
    "10mg": "assets/products-pure/33_cjc-1295_no_dac_10mg.svg"
  },
  "cjc-1295-dac": {
    "5mg": "assets/products-pure/34_cjc-1295_w_dac_5mg.svg",
    "10mg": "assets/products-pure/35_cjc-1295_w_dac_10mg.svg"
  },
  "cjc-ipamorelin": {
    "10mg/10mg": "assets/products-pure/36_cjc_ipamorelin_10mg_10mg.svg"
  },
  "ipamorelin": {
    "5mg": "assets/products-pure/37_ipamorelin_5mg.svg",
    "10mg": "assets/products-pure/38_ipamorelin_10mg.svg"
  },
  "sermorelin": {
    "5mg": "assets/products-pure/39_sermorelin_5mg.svg",
    "10mg": "assets/products-pure/40_sermorelin_10mg.svg"
  },
  "tesamorelin": {
    "10mg": "assets/products-pure/41_tesamorelin_10mg.svg",
    "20mg": "assets/products-pure/42_tesamorelin_20mg.svg"
  },
  "tesa-ipa": {
    "5mg/5mg": "assets/products-pure/43_tesa_ipa_5mg_5mg.svg"
  },
  "semax": {
    "5mg": "assets/products-pure/56_semax_5mg.svg",
    "10mg": "assets/products-pure/57_semax_10mg.svg"
  },
  "selank": {
    "5mg": "assets/products-pure/58_selank_5mg.svg",
    "10mg": "assets/products-pure/59_selank_10mg.svg"
  },
  "semax-selank": {
    "10mg/10mg": "assets/products-pure/60_semax_selank_10mg_10mg.svg"
  },
  "adamax": {
    "10mg": "assets/products-pure/61_adamax_10mg.svg"
  },
  "pinealon": {
    "10mg": "assets/products-pure/55_pinealon_10mg.svg"
  },
  "dsip": {
    "5mg": "assets/products-pure/62_dsip_5mg.svg",
    "10mg": "assets/products-pure/63_dsip_10mg.svg"
  },
  "nad": {
    "500mg": "assets/products-pure/44_nadplus_500mg.svg",
    "1000mg": "assets/products-pure/45_nadplus_1000mg.svg"
  },
  "epithalon": {
    "10mg": "assets/products-pure/46_epithalon_10mg.svg",
    "50mg": "assets/products-pure/47_epithalon_50mg.svg"
  },
  "glutathione": {
    "600mg": "assets/products-pure/48_glutathione_600mg.svg",
    "1500mg": "assets/products-pure/49_glutathione_1500mg.svg"
  },
  "ss-31": {
    "10mg": "assets/products-pure/50_ss-31_10mg.svg",
    "50mg": "assets/products-pure/51_ss-31_50mg.svg"
  },
  "mots-c": {
    "10mg": "assets/products-pure/52_mots-c_10mg.svg",
    "20mg": "assets/products-pure/53_mots-c_20mg.svg",
    "40mg": "assets/products-pure/54_mots-c_40mg.svg"
  },
  "b-12": {
    "10mg": "assets/products-pure/19_b-12_10mg.svg"
  },
  "melanotan-ii": {
    "10mg": "assets/products-pure/69_melanotan_ii_10mg.svg"
  },
  "melanotan-1": {
    "10mg": "assets/products-pure/70_melanotan_1_10mg.svg"
  },
  "pt-141": {
    "10mg": "assets/products-pure/71_pt-141_10mg.svg"
  },
  "kisspeptin": {
    "5mg": "assets/products-pure/72_kisspeptin_5mg.svg",
    "10mg": "assets/products-pure/73_kisspeptin_10mg.svg"
  },
  "oxytocin": {
    "5mg": "assets/products-pure/74_oxytocin_5mg.svg",
    "10mg": "assets/products-pure/75_oxytocin_10mg.svg"
  },
  "vip": {
    "5mg": "assets/products-pure/29_vip_5mg.svg",
    "10mg": "assets/products-pure/30_vip_10mg.svg"
  },
  "bac-3": {
    "3 mL": "assets/products-pure/82_bac_water_3ml.svg"
  },
  "bac-10": {
    "10 mL": "assets/products-pure/83_bac_water_10ml.svg"
  }
};
