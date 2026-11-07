# Alta Pure Labs

A responsive research storefront catalog with search, sorting, category filters, a persistent cart, and a non-binding availability-request flow.

## Run locally

Serve this directory over HTTP (the site uses local JavaScript assets):

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Cart and availability requests

Visitors can add catalog items to a cart, adjust quantities, and prepare a JSON availability request. The request is downloaded in the browser; this static site does not send customer information, place orders, reserve inventory, or collect payment. Transactional checkout requires a trusted server and a payment provider.

All products, names, categories and package sizes from the provided pick-and-pack sheet are included. Listed per-unit prices reflect a 200% markup over the source catalog. Shipping is not included. Catalog listings are presented for laboratory research.
