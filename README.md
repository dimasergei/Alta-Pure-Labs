# Alta Pure Labs

A responsive, static catalog of lyophilized research powders with search, sorting, a persistent inquiry list, and a non-binding availability-request flow.

## Run locally

Serve this directory over HTTP (the site uses local JavaScript assets):

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Inquiry flow

Visitors can add catalog items to an inquiry list, adjust quantities, and prepare a JSON availability request. The request is downloaded in the browser; this static site does not send customer information, place orders, reserve inventory, or collect payment. A secure backend and payment provider would be required for transactional checkout.

Catalog compounds, product names, package sizes and source prices are based on the provided pick-and-pack sheet. Listed per-unit prices reflect a 200% markup over the source catalog. Shipping is not included. Catalog listings are presented for laboratory research.
