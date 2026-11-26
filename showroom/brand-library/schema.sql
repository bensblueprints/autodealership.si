CREATE TABLE IF NOT EXISTS public.oem_brand_references (
    id text PRIMARY KEY,
    name text NOT NULL,
    guidance jsonb NOT NULL,
    reviewed date NOT NULL
);
CREATE TABLE IF NOT EXISTS public.oem_brand_reference_art (
    brand text NOT NULL REFERENCES public.oem_brand_references(id),
    object_id integer NOT NULL,
    label text NOT NULL,
    source_url text NOT NULL,
    source_digest text NOT NULL,
    digest text NOT NULL,
    image bytea NOT NULL,
    PRIMARY KEY (brand, object_id),
    CHECK (digest = encode(sha256(image), 'hex'))
);
