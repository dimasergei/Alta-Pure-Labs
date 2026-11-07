# Alta Pure Labs

A responsive, static research catalog with category filtering, search, sorting, a persistent inquiry list, and a non-binding availability-request flow.

## Run locally

Serve this directory over HTTP (the site uses local JavaScript assets):

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Inquiry flow

Visitors can add catalog items to an inquiry list, adjust quantities, and prepare a JSON availability request. The request is downloaded in the browser; this static site does not send customer information, place orders, reserve inventory, or collect payment. A secure backend and payment provider would be required for transactional checkout.

Catalog product names, package sizes, categories and listed per-unit prices are based on the provided wholesale pick-and-pack sheet. Shipping is not included. All catalog items are presented for research and laboratory purposes only and are not for human or veterinary use.
