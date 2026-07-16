-- encrypt-fn.sql — installs the pgsodium encryption RPC used by toss-pay.
create or replace function encrypt_shipping(key_id uuid, plaintext text)
returns text language sql security definer as $$
  select encode(
    pgsodium.crypto_aead_det_encrypt(plaintext::bytea, ''::bytea, key_id),
    'base64'
  );
$$;
