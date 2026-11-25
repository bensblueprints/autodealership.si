CREATE TABLE IF NOT EXISTS public.vin_spec_cache (
    vin text PRIMARY KEY,
    catalog_release text NOT NULL,
    specs jsonb NOT NULL,
    decoded_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.vehicle_specs(requested_vin text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    release_id constant text := '2026-11';
    result jsonb;
BEGIN
    IF requested_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN RETURN NULL; END IF;
    SELECT specs INTO result FROM public.vin_spec_cache
    WHERE vin=requested_vin AND catalog_release=release_id;
    IF FOUND THEN RETURN result; END IF;
    SELECT jsonb_object_agg(code,value) INTO result FROM vpic.spvindecode(requested_vin)
    WHERE code IS NOT NULL AND nullif(trim(value),'') IS NOT NULL
    AND lower(trim(value)) NOT IN ('not applicable','unknown','not available');
    IF result->>'ErrorCode'='0' THEN
        INSERT INTO public.vin_spec_cache(vin,catalog_release,specs)
        VALUES(requested_vin,release_id,result)
        ON CONFLICT(vin) DO UPDATE SET catalog_release=excluded.catalog_release,
        specs=excluded.specs,decoded_at=now() WHERE vin_spec_cache.catalog_release<>excluded.catalog_release;
    END IF;
    RETURN result;
END
$$;
