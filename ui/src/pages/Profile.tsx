// src/pages/Profile.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";
import { COUNTRIES } from "../constants/countries";
import { NIGERIAN_STATES, STATE_TO_LGAS } from "../constants/nigeriaLocations";

type Address = {
  id?: string;
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lga?: string | null;
};

type UserShippingAddress = {
  id?: string;
  label?: string | null;
  recipientName?: string | null;
  phone?: string | null;
  whatsappPhone?: string | null;
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lga?: string | null;
  landmark?: string | null;
  directionsNote?: string | null;
  isDefault?: boolean | null;
  isActive?: boolean | null;
  phoneVerifiedAt?: string | null;
  phoneVerifiedBy?: string | null;
  verificationMeta?: any;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type DeliveryDetails = {
  id?: string | null;
  label?: string;
  recipientName?: string;
  phone?: string;
  whatsappPhone?: string;
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lga?: string | null;
  landmark?: string | null;
  directionsNote?: string | null;
  isDefault?: boolean;
  phoneVerifiedAt?: string | null;
  phoneVerifiedBy?: string | null;
  verificationMeta?: any;
};

type MeResponse = {
  id: string;
  email: string;
  role?:
    | "ADMIN"
    | "SUPER_ADMIN"
    | "SUPER_USER"
    | "SHOPPER"
    | "SUPPLIER"
    | "SUPPLIER_RIDER"
    | null;
  status?: "PENDING" | "PARTIAL" | "VERIFIED" | string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
  createdAt?: string | null;
  address?: Address | null;
  shippingAddress?: UserShippingAddress | null;
  shippingAddresses?: UserShippingAddress[] | null;
  defaultShippingAddressId?: string | null;
};

const emptyAddr: Address = {
  houseNumber: "",
  streetName: "",
  postCode: "",
  town: "",
  city: "",
  state: "",
  country: "Nigeria",
  lga: "",
};

const emptyDelivery = (): DeliveryDetails => ({
  id: null,
  label: "Default delivery",
  recipientName: "",
  phone: "",
  whatsappPhone: "",
  houseNumber: "",
  streetName: "",
  postCode: "",
  town: "",
  city: "",
  state: "",
  country: "Nigeria",
  lga: "",
  landmark: "",
  directionsNote: "",
  isDefault: true,
  phoneVerifiedAt: null,
  phoneVerifiedBy: null,
  verificationMeta: null,
});

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const s = e?.response?.status;
  return s === 401 || s === 403;
}

function normalizeText(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function digitsOnly(s: string) {
  return String(s || "").replace(/[^\d+]/g, "");
}

function normalizePhoneForCompare(s: string) {
  return digitsOnly(s).replace(/^\+/, "");
}

function formatRole(role?: string | null) {
  const r = normalizeText(role);
  if (!r) return "SHOPPER";
  return r.replace(/_/g, " ");
}

function deriveStatus(me: MeResponse | null) {
  return me?.emailVerifiedAt ? "VERIFIED" : "PENDING";
}

function statusBadgeClass(status: string) {
  if (status === "VERIFIED") return "bg-green-50 text-green-700 border-green-200";
  return "bg-zinc-50 text-zinc-700 border-zinc-200";
}

function formatIsoDateForInput(value?: string | null) {
  if (!value) return "";
  const s = String(value).trim();
  if (!s) return "";

  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";

  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function joinAddressLines(addr?: Partial<Address | UserShippingAddress | DeliveryDetails> | null) {
  if (!addr) return "—";

  const parts = [
    addr.houseNumber,
    addr.streetName,
    addr.town,
    addr.city,
    addr.lga,
    addr.state,
    addr.postCode,
    addr.country,
  ]
    .map((x) => normalizeText(x))
    .filter(Boolean);

  return parts.length ? parts.join(", ") : "—";
}

function isNigeria(country?: string | null) {
  return normalizeText(country).toLowerCase() === "nigeria";
}

function getLgasForState(state?: string | null) {
  const s = normalizeText(state);
  if (!s) return [];
  return STATE_TO_LGAS[s] || [];
}

function isDeliveryPhoneVerified(ship: DeliveryDetails | null | undefined) {
  const raw = ship?.phoneVerifiedAt;
  if (raw === undefined || raw === null) return false;
  const s = String(raw).trim().toLowerCase();
  return !!s && s !== "null" && s !== "undefined";
}

function maskPhone(phone?: string | null) {
  const raw = normalizeText(phone);
  if (!raw) return "—";
  if (raw.length <= 4) return raw;
  return `${"*".repeat(Math.max(0, raw.length - 4))}${raw.slice(-4)}`;
}

export default function Profile() {
  const nav = useNavigate();
  const location = useLocation();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [home, setHome] = useState<Address>(emptyAddr);
  const [ship, setShip] = useState<DeliveryDetails>(emptyDelivery());
  const [savingAddr, setSavingAddr] = useState(false);

  const [otp, setOtp] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpSendBusy, setOtpSendBusy] = useState(false);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [otpMaskedPhone, setOtpMaskedPhone] = useState<string | null>(null);

  function isAddrEqual(a?: Address | null, b?: Partial<Address | DeliveryDetails> | null) {
    const ax = a || {};
    const bx = b || {};
    const norm = (v: unknown) => (typeof v === "string" ? v.trim() : "") || "";

    return (
      norm(ax.houseNumber) === norm(bx.houseNumber) &&
      norm(ax.streetName) === norm(bx.streetName) &&
      norm(ax.postCode) === norm(bx.postCode) &&
      norm(ax.town) === norm(bx.town) &&
      norm(ax.city) === norm(bx.city) &&
      norm(ax.state) === norm(bx.state) &&
      norm(ax.country) === norm(bx.country) &&
      norm(ax.lga) === norm(bx.lga)
    );
  }

  const displayName = useMemo(() => {
    if (!me) return "";
    const f = normalizeText(me.firstName);
    const m = normalizeText(me.middleName);
    const l = normalizeText(me.lastName);
    const full = [f, m, l].filter(Boolean).join(" ").trim();
    if (full) return full;
    return normalizeText(me.email) || "Account user";
  }, [me]);

  const signedInAs = useMemo(() => {
    if (!me) return "—";
    return displayName || normalizeText(me.email) || "—";
  }, [displayName, me]);

  const safeRole = useMemo(() => formatRole(me?.role), [me?.role]);
  const safeStatus = useMemo(() => deriveStatus(me), [me]);
  const isEmailVerified = useMemo(() => Boolean(me?.emailVerifiedAt), [me]);

  const deliveryPhone = useMemo(() => {
    const fromShipping = normalizeText(me?.shippingAddress?.phone) || normalizeText(ship.phone);
    if (fromShipping) return fromShipping;

    const fromWhatsapp =
      normalizeText(me?.shippingAddress?.whatsappPhone) || normalizeText(ship.whatsappPhone);
    if (fromWhatsapp) return fromWhatsapp;

    const fallbackProfilePhone = normalizeText(me?.phone);
    if (fallbackProfilePhone) return fallbackProfilePhone;

    return "—";
  }, [me, ship.phone, ship.whatsappPhone]);

  const deliveryAddressText = useMemo(() => {
    if (me?.shippingAddress) return joinAddressLines(me.shippingAddress);
    return joinAddressLines(ship);
  }, [me, ship]);

  const homeCountryIsNigeria = useMemo(() => isNigeria(home.country), [home.country]);
  const shipCountryIsNigeria = useMemo(() => isNigeria(ship.country), [ship.country]);

  const homeLgas = useMemo(() => {
    if (!homeCountryIsNigeria) return [];
    return getLgasForState(home.state);
  }, [home.state, homeCountryIsNigeria]);

  const shipLgas = useMemo(() => {
    if (!shipCountryIsNigeria) return [];
    return getLgasForState(ship.state);
  }, [ship.state, shipCountryIsNigeria]);

  const sameAddress = useMemo(() => isAddrEqual(home, ship), [home, ship]);
  const deliveryPhoneVerified = useMemo(() => isDeliveryPhoneVerified(ship), [ship]);

  const redirectToLogin = () => {
    nav("/login", {
      replace: true,
      state: { from: location.pathname + location.search },
    });
  };

  useEffect(() => {
    const currentPhone = normalizePhoneForCompare(ship.phone || "");
    const verifiedMetaPhone = normalizePhoneForCompare(
      String(ship.verificationMeta?.verifiedPhone ?? "")
    );
    const verifiedMetaWhatsapp = normalizePhoneForCompare(
      String(ship.verificationMeta?.verifiedWhatsappPhone ?? "")
    );

    if (!currentPhone) {
      setOtp("");
      setOtpMessage(null);
      setOtpMaskedPhone(null);
      return;
    }

    const stillMatchesVerifiedPhone =
      !!ship.phoneVerifiedAt &&
      (!!verifiedMetaPhone || !!verifiedMetaWhatsapp
        ? currentPhone === verifiedMetaPhone || currentPhone === verifiedMetaWhatsapp
        : true);

    if (!stillMatchesVerifiedPhone) {
      setShip((prev) => ({
        ...prev,
        phoneVerifiedAt: null,
        phoneVerifiedBy: null,
        verificationMeta: null,
      }));
      setOtp("");
      setOtpMessage(null);
      setOtpMaskedPhone(null);
    }
  }, [ship.phone, ship.whatsappPhone]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const res = await api.get("/api/profile/me", AXIOS_COOKIE_CFG);
        const payload = (res.data?.data ?? res.data) as MeResponse;
        if (cancelled) return;

        setMe(payload);

        const a = payload.address || {};
        const shippingSource = payload.shippingAddress || null;

        const nextHome: Address = {
          houseNumber: a.houseNumber ?? "",
          streetName: a.streetName ?? "",
          postCode: a.postCode ?? "",
          town: a.town ?? "",
          city: a.city ?? "",
          state: a.state ?? "",
          country: a.country ?? "Nigeria",
          lga: a.lga ?? "",
        };

        const nextShip: DeliveryDetails = {
          id: shippingSource?.id ?? null,
          label: shippingSource?.label ?? "Default delivery",
          recipientName:
            shippingSource?.recipientName ??
            [payload.firstName, payload.lastName].filter(Boolean).join(" ").trim(),
          phone: shippingSource?.phone ?? "",
          whatsappPhone: shippingSource?.whatsappPhone ?? shippingSource?.phone ?? "",
          houseNumber: shippingSource?.houseNumber ?? "",
          streetName: shippingSource?.streetName ?? "",
          postCode: shippingSource?.postCode ?? "",
          town: shippingSource?.town ?? "",
          city: shippingSource?.city ?? "",
          state: shippingSource?.state ?? "",
          country: shippingSource?.country ?? "Nigeria",
          lga: shippingSource?.lga ?? "",
          landmark: shippingSource?.landmark ?? "",
          directionsNote: shippingSource?.directionsNote ?? "",
          isDefault: true,
          phoneVerifiedAt: shippingSource?.phoneVerifiedAt ?? null,
          phoneVerifiedBy: shippingSource?.phoneVerifiedBy ?? null,
          verificationMeta: shippingSource?.verificationMeta ?? null,
        };

        setHome(nextHome);
        setShip(nextShip);
        setOtpMaskedPhone(
          shippingSource?.whatsappPhone
            ? maskPhone(shippingSource.whatsappPhone)
            : shippingSource?.phone
              ? maskPhone(shippingSource.phone)
              : null
        );
      } catch (e: any) {
        if (cancelled) return;

        if (isAuthError(e)) {
          redirectToLogin();
          return;
        }

        setErr(e?.response?.data?.error || "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nav]);

  const onHome =
    (k: keyof Address) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const v = e.target.value;

      setHome((prev) => {
        const next = { ...prev, [k]: v };

        if (k === "country" && !isNigeria(v)) {
          next.state = "";
          next.lga = "";
        }

        if (k === "state") {
          next.lga = "";
        }

        return next;
      });
    };

  const onShip =
    (k: keyof DeliveryDetails) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const v = e.target.value;

      setShip((prev) => {
        const next = { ...prev, [k]: v };

        if (k === "country" && !isNigeria(v)) {
          next.state = "";
          next.lga = "";
        }

        if (k === "state") {
          next.lga = "";
        }

        return next;
      });
    };

  const resendEmail = async () => {
    setErr(null);
    setMsg(null);

    try {
      await api.post("/api/auth/resend-email", {}, AXIOS_COOKIE_CFG);
      setMsg("Verification email sent.");
    } catch (e: any) {
      if (isAuthError(e)) return redirectToLogin();
      setErr(e?.response?.data?.error || "Failed to resend verification email");
    }
  };

  const sendDeliveryOtp = async () => {
    if (!ship.id) {
      setErr("Save your delivery details first before requesting OTP.");
      return;
    }

    setErr(null);
    setMsg(null);
    setOtpMessage(null);
    setOtpSendBusy(true);

    try {
      const profileRes = await api.get("/api/profile/me", AXIOS_COOKIE_CFG);
      const latest = (profileRes.data?.data ?? profileRes.data) as MeResponse;

      const latestShipping =
        latest?.shippingAddress && String(latest.shippingAddress.id || "") === String(ship.id)
          ? latest.shippingAddress
          : (latest?.shippingAddresses || []).find(
              (x) => String(x?.id || "") === String(ship.id)
            ) || null;

      if (!latestShipping) {
        setErr("Could not find your saved delivery details. Please save them again.");
        return;
      }

      const rawWhatsapp = normalizeText(latestShipping.whatsappPhone || ship.whatsappPhone || "");
      const rawPhone = normalizeText(latestShipping.phone || ship.phone || "");

      const normalizedWhatsapp = normalizePhoneForCompare(rawWhatsapp);
      const normalizedPhone = normalizePhoneForCompare(rawPhone);

      const whatsappLooksValid = normalizedWhatsapp.length >= 8;
      const phoneLooksValid = normalizedPhone.length >= 8;

      setShip((prev) => ({
        ...prev,
        phone: latestShipping?.phone ?? prev.phone,
        whatsappPhone: latestShipping?.whatsappPhone ?? prev.whatsappPhone,
        phoneVerifiedAt: latestShipping?.phoneVerifiedAt ?? null,
        phoneVerifiedBy: latestShipping?.phoneVerifiedBy ?? null,
        verificationMeta: latestShipping?.verificationMeta ?? prev.verificationMeta ?? null,
      }));

      if (!whatsappLooksValid && !phoneLooksValid) {
        setErr("Please enter a valid delivery phone or WhatsApp number before requesting OTP.");
        return;
      }

      if (latestShipping?.phoneVerifiedAt) {
        const maskedAlreadyVerified = rawWhatsapp
          ? maskPhone(rawWhatsapp)
          : rawPhone
            ? maskPhone(rawPhone)
            : null;

        setOtpMaskedPhone(maskedAlreadyVerified);
        setOtpMessage("This delivery phone is already verified.");
        setMsg("This delivery phone is already verified.");
        return;
      }

      const { data } = await api.post(
        `/api/profile/shipping-addresses/${encodeURIComponent(String(ship.id))}/request-phone-otp`,
        {},
        AXIOS_COOKIE_CFG
      );

      const preferredMask = rawWhatsapp
        ? maskPhone(rawWhatsapp)
        : rawPhone
          ? maskPhone(rawPhone)
          : null;

      const masked = data?.maskedPhone || preferredMask;
      setOtpMaskedPhone(masked);
      setOtpMessage(data?.message || "OTP sent successfully.");
      setMsg(data?.message || "OTP sent successfully.");
    } catch (e: any) {
      if (isAuthError(e)) {
        redirectToLogin();
        return;
      }

      const apiError =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Failed to send OTP";

      console.error("[Profile/sendDeliveryOtp] failed:", {
        status: e?.response?.status,
        data: e?.response?.data,
        shipId: ship.id,
        phone: ship.phone,
        whatsappPhone: ship.whatsappPhone,
      });

      setErr(String(apiError));
    } finally {
      setOtpSendBusy(false);
    }
  };

  const verifyDeliveryOtp = async () => {
    if (!ship.id) {
      setErr("Save your delivery details first before verifying OTP.");
      return;
    }

    if (!otp.trim()) {
      setErr("Enter the OTP sent to your delivery phone.");
      return;
    }

    setErr(null);
    setMsg(null);
    setOtpMessage(null);
    setOtpBusy(true);

    try {
      const { data } = await api.post(
        `/api/profile/shipping-addresses/${encodeURIComponent(String(ship.id))}/verify-phone`,
        { otp: otp.trim() },
        AXIOS_COOKIE_CFG
      );

      const updated = data?.data ?? null;
      const verifiedAt = updated?.phoneVerifiedAt ?? new Date().toISOString();

      setShip((prev) => ({
        ...prev,
        id: updated?.id ?? prev.id,
        phone: updated?.phone ?? prev.phone,
        whatsappPhone: updated?.whatsappPhone ?? prev.whatsappPhone,
        phoneVerifiedAt: verifiedAt,
        phoneVerifiedBy: updated?.phoneVerifiedBy ?? "CHECKOUT_DELIVERY_OTP",
        verificationMeta: updated?.verificationMeta ?? prev.verificationMeta ?? null,
      }));

      setMe((prev) =>
        prev
          ? {
              ...prev,
              shippingAddress: {
                ...(prev.shippingAddress || {}),
                ...(updated || {}),
                phoneVerifiedAt: verifiedAt,
                phoneVerifiedBy: updated?.phoneVerifiedBy ?? "CHECKOUT_DELIVERY_OTP",
                verificationMeta: updated?.verificationMeta ?? null,
              },
            }
          : prev
      );

      setOtp("");
      setOtpMaskedPhone(
        maskPhone(updated?.whatsappPhone || updated?.phone || ship.whatsappPhone || ship.phone)
      );
      setOtpMessage("Delivery phone verified successfully.");
      setMsg("Delivery phone verified successfully.");
    } catch (e: any) {
      if (isAuthError(e)) {
        redirectToLogin();
        return;
      }

      const apiError =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Invalid OTP";

      console.error("[Profile/verifyDeliveryOtp] failed:", {
        status: e?.response?.status,
        data: e?.response?.data,
        shipId: ship.id,
      });

      setErr(String(apiError));
    } finally {
      setOtpBusy(false);
    }
  };

  const saveAddresses = async () => {
    if (!me) {
      redirectToLogin();
      return;
    }

    setErr(null);
    setMsg(null);

    const homeReq = ["houseNumber", "streetName", "city", "state", "country"] as const;
    for (const key of homeReq) {
      const val = (home as any)[key];
      if (!val || !String(val).trim()) {
        setErr("Please complete the required Home Address fields.");
        return;
      }
    }

    const shipReq = [
      "recipientName",
      "phone",
      "houseNumber",
      "streetName",
      "city",
      "state",
      "country",
    ] as const;

    for (const key of shipReq) {
      const val = (ship as any)[key];
      if (!val || !String(val).trim()) {
        setErr("Please complete the required Delivery Details fields.");
        return;
      }
    }

    const shippingPayload = {
      label: ship.label?.trim() || "Default delivery",
      recipientName: ship.recipientName?.trim() || "",
      phone: ship.phone?.trim() || "",
      whatsappPhone: ship.whatsappPhone?.trim() || "",
      houseNumber: ship.houseNumber || "",
      streetName: ship.streetName || "",
      postCode: ship.postCode || "",
      town: ship.town || "",
      city: ship.city || "",
      state: ship.state || "",
      country: ship.country || "Nigeria",
      lga: ship.lga || "",
      landmark: ship.landmark || "",
      directionsNote: ship.directionsNote || "",
      isDefault: true,
    };

    const prevPhone = normalizePhoneForCompare(me?.shippingAddress?.phone || "");
    const nextPhone = normalizePhoneForCompare(shippingPayload.phone || "");
    const prevWhatsapp = normalizePhoneForCompare(me?.shippingAddress?.whatsappPhone || "");
    const nextWhatsapp = normalizePhoneForCompare(shippingPayload.whatsappPhone || "");

    const phoneChanged =
      (!!prevPhone && !!nextPhone && prevPhone !== nextPhone) ||
      (!!prevWhatsapp && !!nextWhatsapp && prevWhatsapp !== nextWhatsapp) ||
      (!!prevPhone && !nextPhone) ||
      (!!prevWhatsapp && !nextWhatsapp);

    setSavingAddr(true);

    try {
      await api.post(
        "/api/profile/address",
        {
          houseNumber: home.houseNumber,
          streetName: home.streetName,
          postCode: home.postCode || "",
          town: home.town || "",
          city: home.city,
          state: home.state,
          country: home.country,
          lga: home.lga || "",
        },
        AXIOS_COOKIE_CFG
      );

      let savedShipping: any;

      if (ship.id) {
        const { data } = await api.patch(
          `/api/profile/shipping-addresses/${encodeURIComponent(ship.id)}`,
          shippingPayload,
          AXIOS_COOKIE_CFG
        );
        savedShipping = data?.data ?? data;

        await api.post(
          `/api/profile/shipping-addresses/${encodeURIComponent(ship.id)}/default`,
          {},
          AXIOS_COOKIE_CFG
        );
      } else {
        const { data } = await api.post(
          "/api/profile/shipping-addresses",
          shippingPayload,
          AXIOS_COOKIE_CFG
        );
        savedShipping = data?.data ?? data;
      }

      const normalizedSavedShipping: UserShippingAddress = {
        id: savedShipping?.id ?? ship.id ?? null,
        label: savedShipping?.label ?? shippingPayload.label,
        recipientName: savedShipping?.recipientName ?? shippingPayload.recipientName,
        phone: savedShipping?.phone ?? shippingPayload.phone,
        whatsappPhone: savedShipping?.whatsappPhone ?? shippingPayload.whatsappPhone,
        houseNumber: savedShipping?.houseNumber ?? shippingPayload.houseNumber,
        streetName: savedShipping?.streetName ?? shippingPayload.streetName,
        postCode: savedShipping?.postCode ?? shippingPayload.postCode,
        town: savedShipping?.town ?? shippingPayload.town,
        city: savedShipping?.city ?? shippingPayload.city,
        state: savedShipping?.state ?? shippingPayload.state,
        country: savedShipping?.country ?? shippingPayload.country,
        lga: savedShipping?.lga ?? shippingPayload.lga,
        landmark: savedShipping?.landmark ?? shippingPayload.landmark,
        directionsNote: savedShipping?.directionsNote ?? shippingPayload.directionsNote,
        isDefault: true,
        isActive: true,
        phoneVerifiedAt: phoneChanged ? null : savedShipping?.phoneVerifiedAt ?? null,
        phoneVerifiedBy: phoneChanged ? null : savedShipping?.phoneVerifiedBy ?? null,
        verificationMeta: phoneChanged ? null : savedShipping?.verificationMeta ?? null,
      };

      setShip((prev) => ({
        ...prev,
        id: normalizedSavedShipping.id ?? prev.id ?? null,
        label: normalizedSavedShipping.label ?? prev.label,
        recipientName: normalizedSavedShipping.recipientName ?? prev.recipientName,
        phone: normalizedSavedShipping.phone ?? prev.phone,
        whatsappPhone: normalizedSavedShipping.whatsappPhone ?? prev.whatsappPhone,
        houseNumber: normalizedSavedShipping.houseNumber ?? prev.houseNumber,
        streetName: normalizedSavedShipping.streetName ?? prev.streetName,
        postCode: normalizedSavedShipping.postCode ?? prev.postCode,
        town: normalizedSavedShipping.town ?? prev.town,
        city: normalizedSavedShipping.city ?? prev.city,
        state: normalizedSavedShipping.state ?? prev.state,
        country: normalizedSavedShipping.country ?? prev.country,
        lga: normalizedSavedShipping.lga ?? prev.lga,
        landmark: normalizedSavedShipping.landmark ?? prev.landmark,
        directionsNote: normalizedSavedShipping.directionsNote ?? prev.directionsNote,
        isDefault: true,
        phoneVerifiedAt: normalizedSavedShipping.phoneVerifiedAt ?? null,
        phoneVerifiedBy: normalizedSavedShipping.phoneVerifiedBy ?? null,
        verificationMeta: normalizedSavedShipping.verificationMeta ?? null,
      }));

      setMe((prev) =>
        prev
          ? {
              ...prev,
              address: { ...(prev.address || {}), ...home },
              shippingAddress: {
                ...(prev.shippingAddress || {}),
                ...normalizedSavedShipping,
              },
              defaultShippingAddressId:
                normalizedSavedShipping.id ?? prev.defaultShippingAddressId ?? null,
            }
          : prev
      );

      if (phoneChanged) {
        setOtp("");
        setOtpMessage(null);
        setOtpMaskedPhone(
          normalizedSavedShipping.whatsappPhone
            ? maskPhone(normalizedSavedShipping.whatsappPhone)
            : normalizedSavedShipping.phone
              ? maskPhone(normalizedSavedShipping.phone)
              : null
        );
      }

      setMsg("Addresses saved successfully.");
    } catch (e: any) {
      if (isAuthError(e)) {
        redirectToLogin();
        return;
      }
      setErr(e?.response?.data?.error || "Failed to save addresses");
    } finally {
      setSavingAddr(false);
    }
  };

  if (loading) {
    return (
      <SiteLayout>
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
          <div className="rounded-xl border bg-white p-6">
            <div className="animate-pulse text-sm text-ink-soft">Loading your profile…</div>
          </div>
        </div>
      </SiteLayout>
    );
  }

  if (err && !me) {
    return (
      <SiteLayout>
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
          <div className="rounded-xl border bg-white p-6 text-red-700">{err}</div>
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-primary-700">My Account</h1>
            <p className="text-sm opacity-70">Manage your addresses and view your account details.</p>
          </div>
        </div>

        {msg && (
          <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2">
            {msg}
          </div>
        )}
        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2">
            {err}
          </div>
        )}

        {me && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-ink-soft">Signed in as</div>
              <div className="font-medium break-all">{signedInAs}</div>
              <div className="mt-1 text-xs opacity-70 break-all">{me.email || "—"}</div>

              <div className="mt-3 text-xs flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] bg-primary-50 text-primary-700 border-primary-200">
                  Role: {safeRole}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusBadgeClass(
                    safeStatus
                  )}`}
                >
                  Status: {safeStatus}
                </span>
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-ink-soft">Email</div>
              <div className="font-medium break-all">{me.email || "—"}</div>
              <div className={`mt-2 text-sm ${isEmailVerified ? "text-green-700" : "text-amber-700"}`}>
                {isEmailVerified ? "Verified" : "Not verified"}
              </div>

              {!isEmailVerified && (
                <div className="mt-3">
                  <button
                    onClick={resendEmail}
                    className="text-sm underline text-primary-700 disabled:opacity-50"
                    title="Resend verification email"
                  >
                    Resend verification email
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-ink-soft">Delivery address / Delivery details</div>
              <div className="mt-2 space-y-2 text-sm">
                <div>
                  <div className="text-xs text-ink-soft">Delivery phone</div>
                  <div className="font-medium break-words">{deliveryPhone}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-soft">WhatsApp phone</div>
                  <div className="font-medium break-words">
                    {normalizeText(ship.whatsappPhone) || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-soft">Address</div>
                  <div className="font-medium">{deliveryAddressText}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-soft">Recipient</div>
                  <div className="font-medium">{normalizeText(ship.recipientName) || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-soft">Delivery phone status</div>
                  <div className={`font-medium ${deliveryPhoneVerified ? "text-green-700" : "text-amber-700"}`}>
                    {deliveryPhoneVerified ? "Verified" : "Not verified"}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 gap-4">
          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Phone</h2>
              <span className="text-[11px] rounded-full px-2 py-0.5 border bg-zinc-100 text-zinc-600 border-zinc-200">
                Read only
              </span>
            </div>
            <input
              className="mt-2 w-full rounded-lg border border-border bg-zinc-100 text-ink-soft px-3 py-2.5"
              value={me?.phone || ""}
              disabled
            />
          </div>

          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Date of birth</h2>
              <span className="text-[11px] rounded-full px-2 py-0.5 border bg-zinc-100 text-zinc-600 border-zinc-200">
                Read only
              </span>
            </div>
            <input
              type="date"
              className="mt-2 w-full rounded-lg border border-border bg-zinc-100 text-ink-soft px-3 py-2.5"
              value={formatIsoDateForInput(me?.dateOfBirth)}
              disabled
            />
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink">Home address</h2>
              <span className="text-[11px] rounded-full px-2 py-0.5 border bg-primary-50 text-primary-700 border-primary-200">
                Required
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="House number" value={home.houseNumber || ""} onChange={onHome("houseNumber")} required />
              <Input label="Street name" value={home.streetName || ""} onChange={onHome("streetName")} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Town" value={home.town || ""} onChange={onHome("town")} />
              <Input label="City" value={home.city || ""} onChange={onHome("city")} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectField
                label="Country"
                value={home.country || ""}
                onChange={onHome("country")}
                required
                options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
                placeholder="Select country"
              />

              {homeCountryIsNigeria ? (
                <SelectField
                  label="State"
                  value={home.state || ""}
                  onChange={onHome("state")}
                  required
                  options={NIGERIAN_STATES.map((s) => ({ value: s, label: s }))}
                  placeholder="Select state"
                />
              ) : (
                <Input label="State / Region" value={home.state || ""} onChange={onHome("state")} required />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {homeCountryIsNigeria ? (
                <SelectField
                  label="LGA"
                  value={home.lga || ""}
                  onChange={onHome("lga")}
                  options={homeLgas.map((lga) => ({ value: lga, label: lga }))}
                  placeholder={home.state ? "Select LGA" : "Select state first"}
                  disabled={!home.state}
                />
              ) : (
                <Input label="County / Province / Area" value={home.lga || ""} onChange={onHome("lga")} />
              )}

              <Input label="Post code" value={home.postCode || ""} onChange={onHome("postCode")} />
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-ink">Delivery details</h2>
                <p className="text-xs text-ink-soft mt-1">
                  This saves to the same default delivery source used by Checkout.
                </p>
              </div>
              {sameAddress && (
                <span className="text-[11px] rounded-full px-2 py-0.5 border bg-emerald-50 text-emerald-700 border-emerald-200">
                  Same as home address
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Address label" value={ship.label || ""} onChange={onShip("label")} required />
              <Input
                label="Recipient name"
                value={ship.recipientName || ""}
                onChange={onShip("recipientName")}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Delivery phone" value={ship.phone || ""} onChange={onShip("phone")} required />
              <Input label="WhatsApp phone" value={ship.whatsappPhone || ""} onChange={onShip("whatsappPhone")} />
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-ink">Delivery phone verification</div>
                  <div className="text-xs text-ink-soft">
                    {deliveryPhoneVerified
                      ? "This delivery phone is already verified."
                      : `Verify the delivery phone${otpMaskedPhone ? ` (${otpMaskedPhone})` : ""} with OTP.`}
                  </div>
                </div>

                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
                    deliveryPhoneVerified
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}
                >
                  {deliveryPhoneVerified ? "Verified" : "Not verified"}
                </span>
              </div>

              {!deliveryPhoneVerified && (
                <>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={sendDeliveryOtp}
                      disabled={
                        otpSendBusy ||
                        !ship.id ||
                        (!normalizeText(ship.phone) && !normalizeText(ship.whatsappPhone))
                      }
                      className="rounded-md border bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 transition disabled:opacity-50"
                    >
                      {otpSendBusy ? "Sending…" : "Send OTP"}
                    </button>

                    <input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      placeholder="Enter OTP"
                      className="w-full rounded-lg border border-border px-3 py-2 bg-surface placeholder:text-ink-soft focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
                    />

                    <button
                      type="button"
                      onClick={verifyDeliveryOtp}
                      disabled={otpBusy || !otp.trim() || !ship.id}
                      className="rounded-md border bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 transition disabled:opacity-50"
                    >
                      {otpBusy ? "Verifying…" : "Verify OTP"}
                    </button>
                  </div>

                  {otpMessage && <div className="text-sm text-primary-700">{otpMessage}</div>}
                </>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="House number" value={ship.houseNumber || ""} onChange={onShip("houseNumber")} required />
              <Input label="Street name" value={ship.streetName || ""} onChange={onShip("streetName")} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Town" value={ship.town || ""} onChange={onShip("town")} />
              <Input label="City" value={ship.city || ""} onChange={onShip("city")} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectField
                label="Country"
                value={ship.country || ""}
                onChange={onShip("country")}
                required
                options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
                placeholder="Select country"
              />

              {shipCountryIsNigeria ? (
                <SelectField
                  label="State"
                  value={ship.state || ""}
                  onChange={onShip("state")}
                  required
                  options={NIGERIAN_STATES.map((s) => ({ value: s, label: s }))}
                  placeholder="Select state"
                />
              ) : (
                <Input label="State / Region" value={ship.state || ""} onChange={onShip("state")} required />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {shipCountryIsNigeria ? (
                <SelectField
                  label="LGA"
                  value={ship.lga || ""}
                  onChange={onShip("lga")}
                  disabled={!ship.state}
                  options={shipLgas.map((lga) => ({ value: lga, label: lga }))}
                  placeholder={ship.state ? "Select LGA" : "Select state first"}
                />
              ) : (
                <Input label="County / Province / Area" value={ship.lga || ""} onChange={onShip("lga")} />
              )}

              <Input label="Post code" value={ship.postCode || ""} onChange={onShip("postCode")} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Landmark" value={ship.landmark || ""} onChange={onShip("landmark")} />
              <Input
                label="Directions note"
                value={ship.directionsNote || ""}
                onChange={onShip("directionsNote")}
              />
            </div>

            <label className="block">
              <span className="block text-sm font-medium text-ink">Extra delivery note</span>
              <textarea
                value={ship.directionsNote || ""}
                onChange={onShip("directionsNote")}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2.5 bg-surface placeholder:text-ink-soft
                  focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
                placeholder="Extra directions"
                rows={3}
              />
            </label>
          </div>
        </section>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={saveAddresses}
            disabled={savingAddr}
            className="rounded-md border bg-accent-500 px-4 py-2 text-white hover:bg-accent-600 transition disabled:opacity-50"
          >
            {savingAddr ? "Saving…" : "Save addresses"}
          </button>
        </div>
      </div>
    </SiteLayout>
  );
}

function Input({
  label,
  value,
  onChange,
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`mt-1 w-full rounded-lg border border-border px-3 py-2.5 bg-surface placeholder:text-ink-soft
          focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition
          ${disabled ? "bg-zinc-100 text-ink-soft cursor-not-allowed" : ""}`}
        placeholder={label}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink">
        {label}
        {required ? " *" : ""}
      </span>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`mt-1 w-full rounded-lg border border-border px-3 py-2.5 bg-surface
          focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition
          ${disabled ? "bg-zinc-100 text-ink-soft cursor-not-allowed" : ""}`}
      >
        <option value="">{placeholder || `Select ${label}`}</option>
        {options.map((opt) => (
          <option key={`${label}-${opt.value}`} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}