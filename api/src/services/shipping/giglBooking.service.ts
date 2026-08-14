// api/src/services/shipping/giglBooking.service.ts
//
// Turns a purchase order into a real, booked GIGL shipment — the call that
// actually notifies GIGL to collect from the supplier's pickup address and
// deliver to the customer. Only used when SHIPPING_PROVIDER=gigl (see
// isGiglEnabled() in giglProvider.ts).

import { prisma } from "../../lib/prisma.js";
import { createGiglShipment, type GiglParcelClass } from "./giglProvider.js";

type AddressLike = {
  houseNumber?: string | null;
  streetName?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  lga?: string | null;
  latitude?: unknown;
  longitude?: unknown;
};

function inferParcelClass(isFragile?: boolean | null, isBulky?: boolean | null): GiglParcelClass {
  if (isBulky) return "BULKY";
  if (isFragile) return "FRAGILE";
  return "STANDARD";
}

function formatAddress(a: AddressLike): string {
  return [a.houseNumber, a.streetName, a.town || a.city, a.state].filter(Boolean).join(", ");
}

function toLatLng(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class GiglBookingError extends Error {}

/**
 * Books a real GIGL shipment for a purchase order and stores the returned
 * waybill as the PO's tracking number. Idempotent — if the PO already has a
 * tracking number, returns it without booking again.
 */
export async function bookGiglShipmentForPurchaseOrder(
  purchaseOrderId: string
): Promise<{ waybill: string }> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      trackingNumber: true,
      shippedFromAddress: {
        select: {
          houseNumber: true,
          streetName: true,
          town: true,
          city: true,
          state: true,
          lga: true,
          latitude: true,
          longitude: true,
        },
      },
      shippedToAddress: {
        select: {
          houseNumber: true,
          streetName: true,
          town: true,
          city: true,
          state: true,
          lga: true,
          latitude: true,
          longitude: true,
        },
      },
      supplier: {
        select: {
          id: true,
          name: true,
          whatsappPhone: true,
          pickupContactName: true,
          pickupContactPhone: true,
          pickupAddress: {
            select: {
              houseNumber: true,
              streetName: true,
              town: true,
              city: true,
              state: true,
              lga: true,
              latitude: true,
              longitude: true,
            },
          },
          registeredAddress: {
            select: {
              houseNumber: true,
              streetName: true,
              town: true,
              city: true,
              state: true,
              lga: true,
              latitude: true,
              longitude: true,
            },
          },
        },
      },
      order: {
        select: {
          id: true,
          shippingAddress: {
            select: {
              houseNumber: true,
              streetName: true,
              town: true,
              city: true,
              state: true,
              lga: true,
              latitude: true,
              longitude: true,
            },
          },
          user: {
            select: { firstName: true, lastName: true, phone: true },
          },
        },
      },
      items: {
        select: {
          orderItem: {
            select: {
              title: true,
              quantity: true,
              weightGrams: true,
              product: { select: { isFragile: true, isBulky: true } },
            },
          },
        },
      },
    },
  });

  if (!po) {
    throw new GiglBookingError(`PurchaseOrder ${purchaseOrderId} not found`);
  }

  // Already booked — don't create a duplicate shipment with GIGL.
  if (po.trackingNumber) {
    return { waybill: po.trackingNumber };
  }

  const pickup: AddressLike | null =
    po.shippedFromAddress ?? po.supplier?.pickupAddress ?? po.supplier?.registeredAddress ?? null;
  const destination: AddressLike | null = po.shippedToAddress ?? po.order?.shippingAddress ?? null;

  if (!pickup?.state) {
    throw new GiglBookingError(`No pickup address (with state) available for PO ${purchaseOrderId}`);
  }
  if (!destination?.state) {
    throw new GiglBookingError(`No destination address (with state) available for PO ${purchaseOrderId}`);
  }

  const senderName = po.supplier?.pickupContactName || po.supplier?.name || "Supplier";
  const senderPhone = po.supplier?.pickupContactPhone || po.supplier?.whatsappPhone || "";
  if (!senderPhone) {
    throw new GiglBookingError(`No sender phone on file for supplier of PO ${purchaseOrderId}`);
  }

  const buyer = po.order?.user;
  const receiverName = [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ") || "Customer";
  const receiverPhone = buyer?.phone || "";
  if (!receiverPhone) {
    throw new GiglBookingError(`No receiver phone on file for the customer of PO ${purchaseOrderId}`);
  }

  const items = po.items
    .map(({ orderItem }) => {
      if (!orderItem) return null;
      const weightGrams = Math.max(1, Number(orderItem.weightGrams) || 500); // default 0.5kg if unset
      return {
        itemName: orderItem.title || "Item",
        weightKg: weightGrams / 1000,
        quantity: Math.max(1, Number(orderItem.quantity) || 1),
        parcelClass: inferParcelClass(orderItem.product?.isFragile, orderItem.product?.isBulky),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!items.length) {
    throw new GiglBookingError(`No items found for PO ${purchaseOrderId}`);
  }

  const result = await createGiglShipment({
    sender: {
      name: senderName,
      phone: senderPhone,
      address: formatAddress(pickup),
      state: pickup.state,
      lga: pickup.lga,
      latitude: toLatLng(pickup.latitude),
      longitude: toLatLng(pickup.longitude),
    },
    receiver: {
      name: receiverName,
      phone: receiverPhone,
      address: formatAddress(destination),
      state: destination.state,
      lga: destination.lga,
      latitude: toLatLng(destination.latitude),
      longitude: toLatLng(destination.longitude),
    },
    items,
  });

  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: {
      trackingNumber: result.waybill,
      shippingCarrierName: "GIGL",
    },
  });

  return { waybill: result.waybill };
}
