/**
 * Web Push (VAPID) public key. Public by design: the browser hands it to the push
 * service so only the holder of the matching private key can send to this app.
 * The private key lives only in the WEB_PUSH_PRIVATE_KEY GitHub secret
 * (see .github/workflows/push-notifications.yml).
 */
export const WEB_PUSH_PUBLIC_KEY = "BEWP6f67JVcgFEF03XypfKtNFBEZBGr8a2zj7B-cwqd1SnpD8GA79U_xayEKDJ65a6y7nnZnDIxgbA7xGuezWck";
