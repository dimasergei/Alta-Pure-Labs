(function () {
  const currencies = ["USD", "CAD", "EUR", "GBP", "AUD"];
  const languages = ["en", "fr", "es"];
  const locales = { en: "en-US", fr: "fr-CA", es: "es-ES" };
  const translations = {
    en: {
      announcement:"Research use only. Pick-and-pack included. Shipping billed separately.", featured:"Featured", catalog:"Catalog", faq:"FAQ", account:"Account", currency:"Currency", language:"Language",
      heroTitle1:"Research, all", heroTitle2:"in one place.", heroDescription:"Research compounds and laboratory supplies. Explore the AltaPure catalog with clear, per-unit pricing.",
      shopCompounds:"Shop compounds", heroDisclaimer:"Laboratory research only. Not for human or animal use.", researchTitle:"A closer look at research.",
      researchDescription:"Explore peptides and compounds across the current catalog. Compare available sizes, then build your research request.",
      exploreCatalog:"Explore the catalog", featuredTitle:"Featured compounds.", viewAllProducts:"View all products", researchCatalog:"Research catalog",
      searchProducts:"Search products", searchPlaceholder:"Search compounds", categories:"Categories", sortProducts:"Sort products", cart:"Cart", checkout:"Review order",
      orderRequest:"Order request", localSummary:"This is a local order summary. No payment is processed.", name:"Name", email:"Email", organization:"Laboratory or organization",
      researchConfirmation:"I confirm this request is for laboratory research only and not for human consumption.", placeRequest:"Place request",
      pricesUSD:"Prices in USD", estimateNote:"Converted estimate · based on USD prices", rateUnavailable:"Live rates unavailable · showing USD",
      displayCurrencyNote:"Converted amounts are estimates based on USD catalog prices.", productSingular:"product", productPlural:"products",
      showMore:"Show more products ({count} remaining)", cartEmpty:"Your cart is empty.", openCart:"Open cart", openCartCount:"Open cart, {count} items",
      each:"each", decrease:"Decrease", increase:"Increase", quantity:"Quantity", selectedDosage:"Selected dosage", perUnit:"per unit", add:"Add",
      subtotal:"Subtotal", shippingNotIncluded:"Shipping not included.", All:"All", "GLP-1 & Metabolic":"GLP-1 & Metabolic",
      "Healing & Recovery":"Healing & Recovery", "Growth Hormone":"Growth Hormone", "Cognitive & Nootropic":"Cognitive & Nootropic",
      Longevity:"Longevity", "Cosmetic & Skin":"Cosmetic & Skin", "Sexual & Hormonal":"Sexual & Hormonal", "BAC Water & Supplies":"BAC Water & Supplies"
    },
    fr: {
      announcement:"Réservé à la recherche. Préparation incluse. Frais d’expédition facturés séparément.", featured:"En vedette", catalog:"Catalogue", faq:"FAQ", account:"Compte", currency:"Devise", language:"Langue",
      heroTitle1:"La recherche,", heroTitle2:"au même endroit.", heroDescription:"Composés de recherche et fournitures de laboratoire. Parcourez le catalogue AltaPure avec des prix clairs à l’unité.",
      shopCompounds:"Voir les composés", heroDisclaimer:"Recherche en laboratoire uniquement. Ne pas utiliser chez l’humain ou l’animal.", researchTitle:"Approfondir la recherche.",
      researchDescription:"Explorez les peptides et composés du catalogue actuel. Comparez les formats, puis préparez votre demande de recherche.",
      exploreCatalog:"Explorer le catalogue", featuredTitle:"Composés en vedette.", viewAllProducts:"Voir tous les produits", researchCatalog:"Catalogue de recherche",
      searchProducts:"Rechercher des produits", searchPlaceholder:"Rechercher des composés", categories:"Catégories", sortProducts:"Trier les produits", cart:"Panier", checkout:"Vérifier la commande",
      orderRequest:"Demande de commande", localSummary:"Ceci est un récapitulatif local. Aucun paiement n’est traité.", name:"Nom", email:"Courriel", organization:"Laboratoire ou organisme",
      researchConfirmation:"Je confirme que cette demande concerne uniquement la recherche en laboratoire et non la consommation humaine.", placeRequest:"Envoyer la demande",
      pricesUSD:"Prix en USD", estimateNote:"Estimation convertie · prix de base en USD", rateUnavailable:"Taux en direct indisponibles · affichage en USD",
      displayCurrencyNote:"Les montants convertis sont indicatifs et basés sur les prix du catalogue en USD.", productSingular:"produit", productPlural:"produits",
      showMore:"Afficher plus de produits ({count} restants)", cartEmpty:"Votre panier est vide.", openCart:"Ouvrir le panier", openCartCount:"Ouvrir le panier, {count} articles",
      each:"chacun", decrease:"Diminuer", increase:"Augmenter", quantity:"Quantité", selectedDosage:"Format sélectionné", perUnit:"par unité", add:"Ajouter",
      subtotal:"Sous-total", shippingNotIncluded:"Expédition non incluse.", All:"Tout", "GLP-1 & Metabolic":"GLP-1 et métabolisme",
      "Healing & Recovery":"Récupération", "Growth Hormone":"Hormone de croissance", "Cognitive & Nootropic":"Cognition et nootropiques",
      Longevity:"Longévité", "Cosmetic & Skin":"Cosmétique et peau", "Sexual & Hormonal":"Sexuel et hormonal", "BAC Water & Supplies":"Eau bactériostatique et fournitures"
    },
    es: {
      announcement:"Solo para investigación. Preparación incluida. Envío facturado por separado.", featured:"Destacados", catalog:"Catálogo", faq:"Preguntas frecuentes", account:"Cuenta", currency:"Moneda", language:"Idioma",
      heroTitle1:"Investigación,", heroTitle2:"todo en un solo lugar.", heroDescription:"Compuestos de investigación y suministros de laboratorio. Explore el catálogo de AltaPure con precios claros por unidad.",
      shopCompounds:"Ver compuestos", heroDisclaimer:"Solo para investigación de laboratorio. No apto para uso humano ni animal.", researchTitle:"Una mirada más cercana a la investigación.",
      researchDescription:"Explore los péptidos y compuestos del catálogo actual. Compare los tamaños disponibles y prepare su solicitud de investigación.",
      exploreCatalog:"Explorar el catálogo", featuredTitle:"Compuestos destacados.", viewAllProducts:"Ver todos los productos", researchCatalog:"Catálogo de investigación",
      searchProducts:"Buscar productos", searchPlaceholder:"Buscar compuestos", categories:"Categorías", sortProducts:"Ordenar productos", cart:"Carrito", checkout:"Revisar pedido",
      orderRequest:"Solicitud de pedido", localSummary:"Este es un resumen local. No se procesa ningún pago.", name:"Nombre", email:"Correo electrónico", organization:"Laboratorio u organización",
      researchConfirmation:"Confirmo que esta solicitud es únicamente para investigación de laboratorio y no para consumo humano.", placeRequest:"Enviar solicitud",
      pricesUSD:"Precios en USD", estimateNote:"Estimación convertida · precios base en USD", rateUnavailable:"Tipos de cambio no disponibles · mostrando USD",
      displayCurrencyNote:"Los importes convertidos son estimaciones basadas en los precios del catálogo en USD.", productSingular:"producto", productPlural:"productos",
      showMore:"Mostrar más productos ({count} restantes)", cartEmpty:"Su carrito está vacío.", openCart:"Abrir carrito", openCartCount:"Abrir carrito, {count} artículos",
      each:"cada uno", decrease:"Disminuir", increase:"Aumentar", quantity:"Cantidad", selectedDosage:"Tamaño seleccionado", perUnit:"por unidad", add:"Añadir",
      subtotal:"Subtotal", shippingNotIncluded:"Envío no incluido.", All:"Todos", "GLP-1 & Metabolic":"GLP-1 y metabolismo",
      "Healing & Recovery":"Recuperación", "Growth Hormone":"Hormona de crecimiento", "Cognitive & Nootropic":"Cognición y nootrópicos",
      Longevity:"Longevidad", "Cosmetic & Skin":"Cosmética y piel", "Sexual & Hormonal":"Sexual y hormonal", "BAC Water & Supplies":"Agua bacteriostática y suministros"
    }
  };
  const extendedTranslations = {
  "en": {
    "ageVerificationTitle": "Age verification",
    "ageGateNotice": "Research purposes only",
    "ageGateCopy": "The products in this catalog are strictly for in-vitro laboratory research. They are not for human consumption, supplements, or drugs.",
    "ageGateConfirmAge": "By continuing, you confirm you are 21 or older and that you will use these materials for laboratory research only.",
    "ageGateYes": "I am 21 or older",
    "ageGateNo": "Under 21",
    "ageGateBlocked": "This catalog is limited to adults 21 and older.",
    "spotlightTitleA": "Small vial.",
    "spotlightTitleB": "Full details.",
    "spotlightDescription": "BPC-157, from the Healing & Recovery selection. See every listed size and its exact per-unit price.",
    "spotlightView": "View BPC-157",
    "policyTitle": "Clear prices. No guesswork.",
    "policyDescription": "Compare available sizes and per-unit prices across the catalog. Pick-and-pack is included; shipping is billed separately. Listings are for laboratory research only and are not for human or animal use.",
    "policyExplore": "Explore the catalog",
    "faqEyebrow": "(faqs)",
    "faqHeading": "Common questions about research peptides, ordering, and lab standards.",
    "faqCtaTitle": "Ready to elevate your research.",
    "faqCtaDescription": "Explore the AltaPure Labs catalog and review available research compounds, sizes, and pricing.",
    "faqCtaButton": "Explore Catalog",
    "faqQ01": "What research peptides are available from AltaPure Labs?",
    "faqA01": "AltaPure Labs offers a curated selection of research-grade peptides, small molecules, and related laboratory materials. Browse the catalog by category, search by product name, or review individual product pages for available sizes and pricing.",
    "faqQ02": "Are all products tested for purity and quality?",
    "faqA02": "Our products are supplied with quality and purity testing where applicable. Product-specific documentation and testing details may vary by item and lot. Review the product listing or contact us before ordering if documentation is required for your research program.",
    "faqQ03": "What purity levels are standard for research peptides?",
    "faqA03": "Many research peptides are supplied at high analytical purity, though the exact specification depends on the compound, format, and lot. Review the product-specific information and available documentation before ordering. Purity levels may vary by product and lot.",
    "faqQ04": "How do I interpret a Certificate of Analysis?",
    "faqA04": "A Certificate of Analysis, or COA, provides lot-specific analytical information, which may include identity and purity testing. Review the lot number, test methods, reported results, and storage information. Contact us if you need documentation before placing an order.",
    "faqQ05": "Do you offer custom peptide synthesis?",
    "faqA05": "Custom synthesis requests may be considered for qualified laboratory and research needs. Contact us with the compound, requested quantity, intended in-vitro application, and any required specifications. Requests are subject to review and availability.",
    "faqQ06": "What are proper storage instructions?",
    "faqA06": "Store materials according to the guidance supplied with the product and any applicable documentation. Keep containers sealed and protected from unnecessary heat, moisture, and light where appropriate. Storage requirements can vary by compound.",
    "faqQ07": "How should lyophilized peptides be reconstituted?",
    "faqA07": "Reconstitute lyophilized materials using appropriate laboratory procedures, clean equipment, and a solvent or buffer suitable for the intended in-vitro application. Avoid unnecessary moisture exposure and repeated temperature changes. Follow your laboratory protocol and product documentation.",
    "faqQ08": "What is the shelf life of research peptides?",
    "faqA08": "Shelf life depends on the compound, formulation, storage conditions, and lot-specific documentation. Use the storage and stability information supplied with the product. Do not use material beyond any applicable expiration or stability period.",
    "faqQ09": "Can peptides be damaged during shipping or storage?",
    "faqA09": "Yes. Temperature changes, humidity, physical damage, and improper storage can affect some materials. Inspect your order on receipt and contact us within 48 hours if it arrives damaged, incorrect, or compromised.",
    "faqQ10": "Should peptides be aliquoted after reconstitution?",
    "faqA10": "For laboratory workflows that require repeated use, aliquoting prepared solutions into smaller portions may reduce repeated freeze-thaw exposure. Follow the product documentation and your laboratory’s approved procedures.",
    "faqQ11": "Do you offer bulk discounts?",
    "faqA11": "Bulk and institutional pricing may be available for qualifying orders. Contact us with the product, quantity, organization, and intended laboratory application. Pricing and availability are subject to review.",
    "faqQ12": "Can I order products in different quantities?",
    "faqA12": "Available package sizes and quantities are shown on each product listing. If you need a quantity that is not listed, contact us before placing an order. Requests may be accommodated subject to availability and compliance review.",
    "faqQ13": "Are COAs available before ordering?",
    "faqA13": "Available COAs and product documentation may be provided on request before an order is placed. Contact us with the product name, size, and intended laboratory application. Documentation availability and lot-specific details may vary.",
    "faqQ14": "How do I find a specific peptide?",
    "faqA14": "Use the catalog search bar or category filters to locate a product. You can also browse the full catalog and sort results by name or price. Contact us if you cannot find a specific item.",
    "faqQ15": "What information is included on product pages?",
    "faqA15": "Product pages may include the product name, category, available sizes, per-unit pricing, research-use notice, and other product-specific details. Review the listing carefully before adding an item to your cart.",
    "faqQ16": "Are products manufactured in the USA?",
    "faqA16": "Manufacturing and sourcing details vary by product. AltaPure Labs does not make blanket origin claims. Review the product listing and contact us before ordering if sourcing or origin documentation is important for your research program.",
    "faqQ17": "What does “Research Use Only” mean?",
    "faqA17": "“Research Use Only” means a product is supplied for controlled laboratory research. It is not intended for human or veterinary use, ingestion, injection, diagnosis, treatment, or consumption.",
    "faqQ18": "Do research peptides require special handling?",
    "faqA18": "Yes. Use appropriate personal protective equipment, work in a suitable laboratory environment, and follow your institution’s chemical-hygiene and safety procedures. Review all available product documentation before handling a material.",
    "faqQ19": "Can I use these products outside research?",
    "faqA19": "No. AltaPure Labs products are sold for in-vitro laboratory research only. They are not for human or veterinary use, ingestion, injection, diagnosis, treatment, or any non-research application.",
    "faqQ20": "Are these products FDA approved?",
    "faqA20": "No. AltaPure Labs products are not approved by the FDA or other regulatory agencies for the diagnosis, treatment, cure, or prevention of any disease. They are supplied for laboratory research only and are not intended for human or veterinary use."
  },
  "fr": {
    "ageVerificationTitle": "Vérification de l’âge",
    "ageGateNotice": "À des fins de recherche uniquement",
    "ageGateCopy": "Les produits de ce catalogue sont strictement destinés à la recherche en laboratoire in vitro. Ils ne sont pas destinés à la consommation humaine, ni à servir de suppléments ou de médicaments.",
    "ageGateConfirmAge": "En continuant, vous confirmez avoir au moins 21 ans et utiliser ces matériaux uniquement pour la recherche en laboratoire.",
    "ageGateYes": "J’ai 21 ans ou plus",
    "ageGateNo": "Moins de 21 ans",
    "ageGateBlocked": "Ce catalogue est réservé aux adultes de 21 ans et plus.",
    "spotlightTitleA": "Petit flacon.",
    "spotlightTitleB": "Tous les détails.",
    "spotlightDescription": "BPC-157, dans la sélection Guérison et récupération. Consultez tous les formats proposés et leur prix exact à l’unité.",
    "spotlightView": "Voir BPC-157",
    "policyTitle": "Des prix clairs. Sans approximation.",
    "policyDescription": "Comparez les formats disponibles et les prix à l’unité dans le catalogue. La préparation et l’emballage sont inclus; l’expédition est facturée séparément. Les produits sont réservés à la recherche en laboratoire et ne sont pas destinés à un usage humain ou animal.",
    "policyExplore": "Explorer le catalogue",
    "faqEyebrow": "(FAQ)",
    "faqHeading": "Questions fréquentes sur les peptides de recherche, les commandes et les normes de laboratoire.",
    "faqCtaTitle": "Faites progresser vos recherches.",
    "faqCtaDescription": "Explorez le catalogue AltaPure Labs et consultez les composés de recherche, les formats et les prix disponibles.",
    "faqCtaButton": "Explorer le catalogue",
    "faqQ01": "Quels peptides de recherche sont proposés par AltaPure Labs ?",
    "faqA01": "AltaPure Labs propose une sélection de peptides de qualité recherche, de petites molécules et de matériaux de laboratoire connexes. Parcourez le catalogue par catégorie, recherchez par nom de produit ou consultez les pages individuelles pour connaître les formats et les prix disponibles.",
    "faqQ02": "Tous les produits sont-ils testés pour leur pureté et leur qualité ?",
    "faqA02": "Nos produits sont accompagnés de tests de qualité et de pureté lorsque cela s’applique. La documentation et les détails des analyses peuvent varier selon le produit et le lot. Consultez la fiche du produit ou communiquez avec nous avant de commander si votre programme de recherche exige des documents.",
    "faqQ03": "Quels niveaux de pureté sont habituels pour les peptides de recherche ?",
    "faqA03": "De nombreux peptides de recherche sont fournis avec une pureté analytique élevée, mais la spécification exacte dépend du composé, du format et du lot. Consultez les renseignements propres au produit et la documentation disponible avant de commander. La pureté peut varier selon le produit et le lot.",
    "faqQ04": "Comment interpréter un certificat d’analyse ?",
    "faqA04": "Un certificat d’analyse, ou COA, fournit des renseignements analytiques propres à un lot, qui peuvent comprendre des tests d’identité et de pureté. Vérifiez le numéro de lot, les méthodes d’analyse, les résultats déclarés et les renseignements d’entreposage. Communiquez avec nous si vous avez besoin de documents avant de commander.",
    "faqQ05": "Offrez-vous la synthèse personnalisée de peptides ?",
    "faqA05": "Les demandes de synthèse personnalisée peuvent être étudiées pour des besoins de laboratoire et de recherche admissibles. Communiquez avec nous en précisant le composé, la quantité demandée, l’application in vitro prévue et les spécifications requises. Toute demande est soumise à examen et à la disponibilité.",
    "faqQ06": "Quelles sont les bonnes conditions d’entreposage ?",
    "faqA06": "Entreposez les matériaux conformément aux directives fournies avec le produit et à toute documentation applicable. Gardez les contenants fermés et protégez-les, lorsque cela convient, de la chaleur, de l’humidité et de la lumière excessives. Les exigences d’entreposage varient selon le composé.",
    "faqQ07": "Comment faut-il reconstituer les peptides lyophilisés ?",
    "faqA07": "Reconstituez les matériaux lyophilisés en suivant des procédures de laboratoire appropriées, avec du matériel propre et un solvant ou un tampon adapté à l’application in vitro prévue. Évitez toute exposition inutile à l’humidité et les changements répétés de température. Suivez le protocole de votre laboratoire et la documentation du produit.",
    "faqQ08": "Quelle est la durée de conservation des peptides de recherche ?",
    "faqA08": "La durée de conservation dépend du composé, de la formulation, des conditions d’entreposage et de la documentation propre au lot. Suivez les renseignements d’entreposage et de stabilité fournis avec le produit. N’utilisez pas un matériau au-delà de toute date de péremption ou période de stabilité applicable.",
    "faqQ09": "Les peptides peuvent-ils être endommagés pendant l’expédition ou l’entreposage ?",
    "faqA09": "Oui. Les variations de température, l’humidité, les dommages physiques et un entreposage inadéquat peuvent affecter certains matériaux. Inspectez votre commande à sa réception et communiquez avec nous dans les 48 heures si elle arrive endommagée, incorrecte ou compromise.",
    "faqQ10": "Faut-il répartir les peptides en aliquotes après leur reconstitution ?",
    "faqA10": "Pour les procédures de laboratoire nécessitant des utilisations répétées, la répartition des solutions préparées en petites portions peut réduire les cycles répétés de congélation et de décongélation. Suivez la documentation du produit et les procédures approuvées de votre laboratoire.",
    "faqQ11": "Offrez-vous des rabais sur les achats en gros ?",
    "faqA11": "Des tarifs de volume et institutionnels peuvent être proposés pour les commandes admissibles. Communiquez avec nous en indiquant le produit, la quantité, l’organisation et l’application de laboratoire prévue. Les prix et la disponibilité sont soumis à examen.",
    "faqQ12": "Puis-je commander des produits en différentes quantités ?",
    "faqA12": "Les formats et quantités disponibles figurent sur chaque fiche produit. Si vous avez besoin d’une quantité qui n’est pas indiquée, communiquez avec nous avant de commander. Les demandes peuvent être acceptées selon la disponibilité et l’examen de conformité.",
    "faqQ13": "Les certificats d’analyse sont-ils disponibles avant la commande ?",
    "faqA13": "Les certificats d’analyse disponibles et la documentation du produit peuvent être fournis sur demande avant la commande. Communiquez avec nous en précisant le nom du produit, le format et l’application de laboratoire prévue. La disponibilité des documents et les détails propres au lot peuvent varier.",
    "faqQ14": "Comment trouver un peptide en particulier ?",
    "faqA14": "Utilisez la barre de recherche du catalogue ou les filtres de catégorie pour trouver un produit. Vous pouvez également parcourir le catalogue complet et trier les résultats par nom ou par prix. Communiquez avec nous si vous ne trouvez pas un article précis.",
    "faqQ15": "Quels renseignements figurent sur les pages de produits ?",
    "faqA15": "Les pages de produits peuvent présenter le nom du produit, sa catégorie, les formats disponibles, le prix à l’unité, l’avis relatif à l’utilisation en recherche et d’autres renseignements propres au produit. Examinez attentivement la fiche avant d’ajouter un article au panier.",
    "faqQ16": "Les produits sont-ils fabriqués aux États-Unis ?",
    "faqA16": "Les renseignements sur la fabrication et l’approvisionnement varient selon le produit. AltaPure Labs ne fait pas d’affirmation générale quant à l’origine. Consultez la fiche du produit et communiquez avec nous avant de commander si les documents sur l’approvisionnement ou l’origine sont importants pour votre programme de recherche.",
    "faqQ17": "Que signifie « Réservé à la recherche » ?",
    "faqA17": "« Réservé à la recherche » signifie qu’un produit est fourni pour la recherche contrôlée en laboratoire. Il n’est pas destiné à un usage humain ou vétérinaire, à l’ingestion, à l’injection, au diagnostic, au traitement ou à la consommation.",
    "faqQ18": "Les peptides de recherche nécessitent-ils des précautions particulières ?",
    "faqA18": "Oui. Utilisez l’équipement de protection individuelle approprié, travaillez dans un environnement de laboratoire adapté et suivez les procédures d’hygiène chimique et de sécurité de votre établissement. Consultez toute la documentation disponible sur le produit avant de manipuler un matériau.",
    "faqQ19": "Puis-je utiliser ces produits à d’autres fins que la recherche ?",
    "faqA19": "Non. Les produits AltaPure Labs sont vendus uniquement pour la recherche en laboratoire in vitro. Ils ne sont pas destinés à un usage humain ou vétérinaire, à l’ingestion, à l’injection, au diagnostic, au traitement ou à toute application autre que la recherche.",
    "faqQ20": "Ces produits sont-ils approuvés par la FDA ?",
    "faqA20": "Non. Les produits AltaPure Labs ne sont pas approuvés par la FDA ni par d’autres organismes de réglementation pour diagnostiquer, traiter, guérir ou prévenir une maladie. Ils sont fournis uniquement pour la recherche en laboratoire et ne sont pas destinés à un usage humain ou vétérinaire."
  },
  "es": {
    "ageVerificationTitle": "Verificación de edad",
    "ageGateNotice": "Solo para fines de investigación",
    "ageGateCopy": "Los productos de este catálogo están destinados exclusivamente a la investigación de laboratorio in vitro. No son para consumo humano, suplementos ni medicamentos.",
    "ageGateConfirmAge": "Al continuar, confirma que tiene 21 años o más y que utilizará estos materiales únicamente para investigación de laboratorio.",
    "ageGateYes": "Tengo 21 años o más",
    "ageGateNo": "Menor de 21 años",
    "ageGateBlocked": "Este catálogo está limitado a adultos de 21 años o más.",
    "spotlightTitleA": "Frasco pequeño.",
    "spotlightTitleB": "Todos los detalles.",
    "spotlightDescription": "BPC-157, de la selección de Recuperación y reparación. Consulte todos los tamaños disponibles y su precio exacto por unidad.",
    "spotlightView": "Ver BPC-157",
    "policyTitle": "Precios claros. Sin sorpresas.",
    "policyDescription": "Compare los tamaños disponibles y los precios por unidad en todo el catálogo. La preparación y el embalaje están incluidos; el envío se factura por separado. Los productos se ofrecen únicamente para investigación de laboratorio y no son para uso humano ni animal.",
    "policyExplore": "Explorar el catálogo",
    "faqEyebrow": "(preguntas frecuentes)",
    "faqHeading": "Preguntas frecuentes sobre péptidos de investigación, pedidos y normas de laboratorio.",
    "faqCtaTitle": "Impulse su investigación.",
    "faqCtaDescription": "Explore el catálogo de AltaPure Labs y consulte los compuestos de investigación, tamaños y precios disponibles.",
    "faqCtaButton": "Explorar catálogo",
    "faqQ01": "¿Qué péptidos de investigación ofrece AltaPure Labs?",
    "faqA01": "AltaPure Labs ofrece una selección de péptidos de grado de investigación, moléculas pequeñas y materiales de laboratorio relacionados. Explore el catálogo por categoría, busque por nombre de producto o consulte las páginas individuales para ver los tamaños y precios disponibles.",
    "faqQ02": "¿Se analizan todos los productos para comprobar su pureza y calidad?",
    "faqA02": "Nuestros productos se suministran con pruebas de calidad y pureza cuando corresponde. La documentación específica y los detalles de las pruebas pueden variar según el artículo y el lote. Revise la ficha del producto o contáctenos antes de hacer el pedido si su programa de investigación requiere documentación.",
    "faqQ03": "¿Qué niveles de pureza son habituales en los péptidos de investigación?",
    "faqA03": "Muchos péptidos de investigación se suministran con alta pureza analítica, aunque la especificación exacta depende del compuesto, el formato y el lote. Revise la información específica del producto y la documentación disponible antes de hacer el pedido. La pureza puede variar según el producto y el lote.",
    "faqQ04": "¿Cómo se interpreta un certificado de análisis?",
    "faqA04": "Un certificado de análisis, o COA, proporciona información analítica específica del lote, que puede incluir pruebas de identidad y pureza. Revise el número de lote, los métodos de prueba, los resultados informados y la información de almacenamiento. Contáctenos si necesita documentación antes de realizar un pedido.",
    "faqQ05": "¿Ofrecen síntesis personalizada de péptidos?",
    "faqA05": "Las solicitudes de síntesis personalizada pueden evaluarse para necesidades de laboratorio e investigación que cumplan los requisitos. Contáctenos con el compuesto, la cantidad solicitada, la aplicación in vitro prevista y las especificaciones necesarias. Las solicitudes están sujetas a revisión y disponibilidad.",
    "faqQ06": "¿Cuáles son las instrucciones adecuadas de almacenamiento?",
    "faqA06": "Almacene los materiales de acuerdo con las indicaciones proporcionadas con el producto y la documentación aplicable. Mantenga los envases cerrados y protegidos del calor, la humedad y la luz innecesarios cuando corresponda. Los requisitos de almacenamiento pueden variar según el compuesto.",
    "faqQ07": "¿Cómo deben reconstituirse los péptidos liofilizados?",
    "faqA07": "Reconstituya los materiales liofilizados utilizando procedimientos de laboratorio adecuados, equipos limpios y un disolvente o tampón apropiado para la aplicación in vitro prevista. Evite la exposición innecesaria a la humedad y los cambios repetidos de temperatura. Siga el protocolo de su laboratorio y la documentación del producto.",
    "faqQ08": "¿Cuál es la vida útil de los péptidos de investigación?",
    "faqA08": "La vida útil depende del compuesto, la formulación, las condiciones de almacenamiento y la documentación específica del lote. Utilice la información de almacenamiento y estabilidad suministrada con el producto. No utilice el material después de cualquier fecha de caducidad o período de estabilidad aplicable.",
    "faqQ09": "¿Pueden dañarse los péptidos durante el envío o el almacenamiento?",
    "faqA09": "Sí. Los cambios de temperatura, la humedad, los daños físicos y el almacenamiento inadecuado pueden afectar algunos materiales. Inspeccione su pedido al recibirlo y contáctenos dentro de las 48 horas si llega dañado, incorrecto o comprometido.",
    "faqQ10": "¿Deben dividirse los péptidos en alícuotas después de reconstituirlos?",
    "faqA10": "En los flujos de trabajo de laboratorio que requieren usos repetidos, dividir las soluciones preparadas en porciones más pequeñas puede reducir la exposición repetida a ciclos de congelación y descongelación. Siga la documentación del producto y los procedimientos aprobados de su laboratorio.",
    "faqQ11": "¿Ofrecen descuentos por compras al por mayor?",
    "faqA11": "Puede haber precios por volumen e institucionales para pedidos que cumplan los requisitos. Contáctenos con el producto, la cantidad, la organización y la aplicación de laboratorio prevista. Los precios y la disponibilidad están sujetos a revisión.",
    "faqQ12": "¿Puedo pedir productos en distintas cantidades?",
    "faqA12": "Los tamaños de envase y las cantidades disponibles se muestran en cada ficha del producto. Si necesita una cantidad que no aparece en la lista, contáctenos antes de hacer el pedido. Las solicitudes pueden atenderse según la disponibilidad y la revisión de cumplimiento.",
    "faqQ13": "¿Se pueden obtener los COA antes de hacer el pedido?",
    "faqA13": "Los COA disponibles y la documentación del producto pueden facilitarse previa solicitud antes de realizar un pedido. Contáctenos con el nombre del producto, el tamaño y la aplicación de laboratorio prevista. La disponibilidad de documentación y los detalles específicos del lote pueden variar.",
    "faqQ14": "¿Cómo encuentro un péptido específico?",
    "faqA14": "Utilice la barra de búsqueda del catálogo o los filtros por categoría para encontrar un producto. También puede explorar el catálogo completo y ordenar los resultados por nombre o precio. Contáctenos si no encuentra un artículo específico.",
    "faqQ15": "¿Qué información incluyen las páginas de productos?",
    "faqA15": "Las páginas de productos pueden incluir el nombre del producto, la categoría, los tamaños disponibles, el precio por unidad, el aviso de uso para investigación y otros detalles específicos del producto. Revise cuidadosamente la ficha antes de añadir un artículo al carrito.",
    "faqQ16": "¿Los productos se fabrican en Estados Unidos?",
    "faqA16": "Los detalles de fabricación y abastecimiento varían según el producto. AltaPure Labs no hace afirmaciones generales sobre el origen. Revise la ficha del producto y contáctenos antes de hacer el pedido si la documentación de abastecimiento u origen es importante para su programa de investigación.",
    "faqQ17": "¿Qué significa «Solo para uso en investigación»?",
    "faqA17": "«Solo para uso en investigación» significa que el producto se suministra para investigación controlada de laboratorio. No está destinado al uso humano o veterinario, la ingestión, la inyección, el diagnóstico, el tratamiento ni el consumo.",
    "faqQ18": "¿Los péptidos de investigación requieren un manejo especial?",
    "faqA18": "Sí. Utilice el equipo de protección personal adecuado, trabaje en un entorno de laboratorio apropiado y siga los procedimientos de higiene química y seguridad de su institución. Revise toda la documentación disponible del producto antes de manipular un material.",
    "faqQ19": "¿Puedo utilizar estos productos fuera de la investigación?",
    "faqA19": "No. Los productos de AltaPure Labs se venden únicamente para investigación de laboratorio in vitro. No son para uso humano o veterinario, ingestión, inyección, diagnóstico, tratamiento ni ninguna aplicación ajena a la investigación.",
    "faqQ20": "¿Estos productos están aprobados por la FDA?",
    "faqA20": "No. Los productos de AltaPure Labs no están aprobados por la FDA ni por otros organismos reguladores para diagnosticar, tratar, curar o prevenir ninguna enfermedad. Se suministran únicamente para investigación de laboratorio y no están destinados al uso humano o veterinario."
  }
};
  const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  let currency = currencies.includes(read("ap-currency","USD")) ? read("ap-currency","USD") : "USD";
  let language = languages.includes(read("ap-language","en")) ? read("ap-language","en") : "en";
  let rates = { USD:1 }, ratesLoaded = false;
  const listeners = new Set();
  const t = (key, fallback) => extendedTranslations[language]?.[key] || translations[language][key] || translations.en[key] || fallback || key;
  const notify = () => listeners.forEach((listener) => listener());
  const status = () => {
    const node = document.querySelector("#currency-status");
    if (!node) return;
    node.textContent = currency === "USD" ? t("pricesUSD","Prices in USD") : ratesLoaded ? t("estimateNote","Converted estimate · based on USD prices") : t("rateUnavailable","Live rates unavailable · showing USD");
  };
  const apply = () => {
    document.documentElement.lang = language;
    document.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n,node.textContent); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder,node.placeholder); });
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => node.setAttribute("aria-label",t(node.dataset.i18nAria,node.getAttribute("aria-label"))));
    const faqLink = document.querySelector('.top-links a[href="#faq-section"]');
    if (faqLink) faqLink.textContent = t("faq", "FAQ");
    const submitLabel = document.querySelector("#checkout-form button[type=submit]");
    if (submitLabel && submitLabel.firstChild) {
      const defaultLabel = submitLabel.dataset.defaultLabel || submitLabel.firstChild.textContent.trim();
      submitLabel.dataset.defaultLabel = defaultLabel;
      submitLabel.firstChild.textContent = (language === "en" ? defaultLabel : t("placeRequest", "Place request")) + " ";
    }
    const lang = document.querySelector("#language-select"), curr = document.querySelector("#currency-select");
    if (lang) lang.value = language;
    if (curr) curr.value = currency;
    status();
  };
  const loadRates = async () => {
    if (ratesLoaded) return true;
    try {
      const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=CAD,EUR,GBP,AUD",{cache:"no-store"});
      if (!response.ok) throw new Error("Rate request failed");
      const data = await response.json();
      for (const code of currencies.filter((item) => item !== "USD")) if (!Number.isFinite(data.rates?.[code])) throw new Error("Incomplete rate response");
      rates = {USD:1,...data.rates}; ratesLoaded = true; return true;
    } catch { rates = {USD:1}; return false; }
  };
  const formatMoney = (amount) => {
    const code = ratesLoaded && rates[currency] ? currency : "USD";
    return new Intl.NumberFormat(locales[language],{style:"currency",currency:code,maximumFractionDigits:2}).format(amount*rates[code]);
  };
  const setCurrency = async (next) => {
    if (!currencies.includes(next)) return;
    if (next !== "USD" && !(await loadRates())) { currency="USD"; write("ap-currency",currency); apply(); notify(); return; }
    currency=next; write("ap-currency",currency); apply(); notify();
  };
  const setLanguage = (next) => { if (!languages.includes(next)) return; language=next; write("ap-language",language); apply(); notify(); };
  window.AltaLocale = {t,formatMoney,onChange:(listener)=>listeners.add(listener),setCurrency,setLanguage,get currency(){return currency;},get language(){return language;}};
  const currencySelect=document.querySelector("#currency-select"), languageSelect=document.querySelector("#language-select");
  if(currencySelect){currencySelect.value=currency;currencySelect.addEventListener("change",(event)=>setCurrency(event.target.value));}
  if(languageSelect){languageSelect.value=language;languageSelect.addEventListener("change",(event)=>setLanguage(event.target.value));}
  apply();
  if (currency !== "USD") {
    loadRates().then((loaded) => {
      if (!loaded) { currency = "USD"; write("ap-currency", currency); }
      apply();
      notify();
    });
  }
})();
