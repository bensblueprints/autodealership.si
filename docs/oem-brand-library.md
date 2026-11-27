# OEM brand library

Dealer staff open **Website settings → OEM programs → Manufacturer brand library**. Select a manufacturer to see a reviewed source list, its scope, the review date and what still needs to come from the franchise. A manufacturer listing records research. OEM certification is coming soon.

The initial US catalog covers the 31 manufacturers in the platform's sales navigation research. Toyota and Mazda publish dealer-specific website identity material. INFINITI and Porsche provide digital identity guidance. Other records identify public enrollment resources, restricted dealer systems, trademark contacts or press sites. Each source is labeled separately. Check the relevant program’s current revision before reviewing a dealer promotion. Mazda’s published Tier 3 guide and its later 2025 mark announcement illustrate why version checks matter. [Toyota dealership identity](https://brand.toyota.com/guidelines/extensions/dealerships) · [Mazda Tier 3 website guide](https://www.mazdadigitalcertified.com/docs/MazdaT3WebsiteRedesignStyleGuide.pdf) · [Mazda brand symbol announcement](https://newsroom.mazda.com/en/publicity/release/2025/202510/251029a.html) · [INFINITI digital guide](https://infinitibrand.com/digital-guideline) · [Porsche digital wordmark](https://designsystem.porsche.com/v3/components/wordmark/usage/)

## Private artwork

The reference library contains six embedded logo images from a manufacturer filing dated October 2023. They cover Hyundai, Kia and Genesis. The source document hash, original PDF object number and PNG digest identify each extracted image. The retained photographs or graphics belong to their respective owners. The filing documents mark identity; retailer publishing rights and current artwork require confirmation through the manufacturer. [Manufacturer filing on NHTSA vPIC](https://vpic.nhtsa.dot.gov/mfrportal/Manufacturers/displayfile/16785?guid=4f552324-76b8-4752-a9be-8e826ea59ae2)

The private API reads shared manufacturer research from the platform PostgreSQL database. An administrator can add or replace a dealer-supplied PNG with provenance and permitted-use notes under **Store dealership artwork**. That file, its digest, the submitting user and the revision are saved to the active rooftop database. Staff can preview it in the authenticated workspace. An image update requires the current revision. Website publishing and program review continue through their own dealer controls.

## Import or refresh the reference set

The catalog and source-document hash live in `showroom/brand-library/catalog.json`. After reviewing a source change, update its date and reference details. For the regulatory source, check the original visual artwork and object mapping before replacing its pinned digest. The importer requires Python and PyMuPDF on the preparation machine.

```sh
python showroom/brand-library/prepare.py /private/staging/oem-reference.sql
psql -v ON_ERROR_STOP=1 "$PLATFORM_DATABASE_URL" -f /private/staging/oem-reference.sql
```

Use `--source-pdf PATH` to supply a previously downloaded copy of the reviewed filing. The import checks the original hash before writing its SQL file, creates the central tables, and updates the reference catalog in one transaction. A repeated import preserves dealer uploads. The generated SQL contains the private image collection and belongs outside Git and public hosting.

Test the seeded catalog and isolation against a disposable PostgreSQL database with `BRAND_LIBRARY_TEST_URL` set and run `node --test showroom/tests/oem-brand-library.test.mjs`.

## Reviewing the storefront

Open **Dealer dashboard → Website settings → OEM programs → Storefront review** and select **Run check**. Each report records the dealership, hostname, template, time zone and the findings at the time of the check. The report picker shows the 30 most recent checks. **Download report** exports the selected record as JSON.

**Needs attention** links to the affected page, program or banner editor. For example, when the only eligible vehicle sells, the offer loses its placement. **Expires within 14 days** lists active placements or source approvals that are about to end. After making a correction, run another check to compare results. Each saved report retains its original findings.

The service checks franchise rooftops hourly for a missing daily report, using each dealership’s local date. Independent and Buy Here Pay Here dealers can run checks on demand. Coverage comes from the platform’s publishing records. Manufacturer acceptance, visual layout audits and co-op reimbursement retain their separate evidence requirements.
