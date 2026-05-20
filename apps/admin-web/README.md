# SYLION Admin Web

Live Admin Shell dla etapu V2.

Panel jest serwowany przez Admin API:

```text
http://127.0.0.1:8080/admin
```

Zakres live panelu:

```text
WebAuthn-compatible enrollment/login przez lokalny simulator
health/status API
tworzenie tenantow i operatorow
dodawanie providerow bez wyswietlania plaintext secret
rejestracja Pixel / GrapheneOS, Puli AX i FIDO2
generowanie provisioning planu
uruchamianie orchestrator job
podglad audit stream
demo flow end-to-end z poziomu UI
```

Panel nie ma bundlera. `index.html`, `styles.css` i `app.js` sa serwowane statycznie pod `/admin`.
