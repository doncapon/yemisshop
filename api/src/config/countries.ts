export type CountryConfig = {
  code: string;
  name: string;
  phoneCode: string;
  allowSupplierRegistration: boolean;
};

export const COUNTRIES: CountryConfig[] = [
  { code: "NG", name: "Nigeria", phoneCode: "234", allowSupplierRegistration: true },
];

export const SUPPLIER_REGISTRATION_COUNTRIES = COUNTRIES.filter(
  (c) => c.allowSupplierRegistration
);

export const COUNTRY_MAP = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c])
);