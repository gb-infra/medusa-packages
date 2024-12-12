import {
  ProductCollectionDTO,
  ProductDTO,
  RegionDTO,
  ShippingOptionDTO,
  ShippingProfileDTO,
  StoreDTO,
} from "@medusajs/framework/types";

export const storeFields: (keyof StoreDTO)[] = ["id", "name"];

export const storeRelations = ["currencies"];

export const productFields: (keyof ProductDTO)[] = [
  "id",
  "title",
  "subtitle",
  "description",
  "handle",
  "is_giftcard",
  "discountable",
  "thumbnail",
  "weight",
  "length",
  "height",
  "width",
  "hs_code",
  "origin_country",
  "mid_code",
  "material",
  "metadata",
];
export const regionFields: (keyof RegionDTO)[] = [
  "id",
  "name",
  // "tax_rate",
  // "tax_code",
  "metadata",
];
export const shippingProfileFields: (keyof ShippingProfileDTO)[] = [
  "id",
  "name",
  "type",
  "metadata",
];
export const shippingOptionFields: (keyof ShippingOptionDTO)[] = [
  "id",
  "name",
  "price_type",
  "data",
  "metadata",
];

export const productRelations = [
  "images",
  "options",
  "tags",
  "type",
  "collection",
];
export const regionRelations = [
  "countries",
  "payment_providers",
  "fulfillment_providers",
  "currency",
];
export const shippingProfileRelations = [
  "shipping_options",
  "shipping_options.profile",
  "shipping_options.requirements",
  "shipping_options.provider",
  "shipping_options.region",
  "shipping_options.region.countries",
  "shipping_options.region.payment_providers",
  "shipping_options.region.fulfillment_providers",
  "shipping_options.region.currency",
];
export const shippingOptionRelations = [
  "region",
  "region.countries",
  "region.payment_providers",
  "region.fulfillment_providers",
  "region.currency",
  "profile",
  "profile.products",
  "profile.shipping_options",
  "requirements",
  "provider",
];

export const productCollectionFields: (keyof ProductCollectionDTO)[] = [
  "id",
  "title",
  "handle",
];
