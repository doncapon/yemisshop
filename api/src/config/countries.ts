export type CountryConfig = {
  code: string;
  name: string;
  phoneCode: string;
  allowSupplierRegistration: boolean;
};

export const COUNTRIES: CountryConfig[] = [
  { code: "NG", name: "Nigeria", phoneCode: "234", allowSupplierRegistration: true },
  { code: "KE", name: "Kenya", phoneCode: "254", allowSupplierRegistration: true },
  { code: "RW", name: "Rwanda", phoneCode: "250", allowSupplierRegistration: true },
  { code: "GH", name: "Ghana", phoneCode: "233", allowSupplierRegistration: true },
  { code: "CM", name: "Cameroon", phoneCode: "237", allowSupplierRegistration: true },
  { code: "BJ", name: "Benin Republic", phoneCode: "229", allowSupplierRegistration: true },
  { code: "TG", name: "Togo", phoneCode: "228", allowSupplierRegistration: true },
  { code: "BF", name: "Burkina Faso", phoneCode: "226", allowSupplierRegistration: true },
  { code: "CD", name: "Democratic Republic of the Congo", phoneCode: "243", allowSupplierRegistration: true },
];

export const SUPPLIER_REGISTRATION_COUNTRIES = COUNTRIES.filter(
  (c) => c.allowSupplierRegistration
);

export const COUNTRY_MAP = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c])
);