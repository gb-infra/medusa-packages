import * as _ from "lodash";
import { ProductDTO } from "@medusajs/framework/types";
import { StrapiEntity, StrapiSeedType } from "@types";

export async function transformMedusaToStrapiProduct(
  product: Partial<ProductDTO>
): Promise<Partial<ProductDTO>> {
  const productToSend = _.cloneDeep(product);
  productToSend["product-type"] = _.cloneDeep(productToSend.type);
  delete productToSend.type;
  productToSend["product-tags"] = _.cloneDeep(productToSend.tags);
  delete productToSend.tags;
  productToSend["product-options"] = _.cloneDeep(productToSend.options);
  delete productToSend.options;
  productToSend["product-variants"] = _.cloneDeep(productToSend.variants);
  delete productToSend.variants;

  if (productToSend.collection) {
    productToSend["product-collections"] = _.cloneDeep(
      productToSend.collection
    );
  }
  if (productToSend.categories) {
    productToSend["product-categories"] = _.cloneDeep(productToSend.categories);
  }

  delete productToSend.collection;
  return productToSend;
}

export async function translateIdsToMedusaIds(
  dataToSend: StrapiSeedType
): Promise<
  StrapiEntity | Record<string, StrapiEntity> | Record<string, StrapiEntity[]>
> {
  if (!dataToSend) {
    return dataToSend;
  }
  const keys = Object.keys(dataToSend);
  for (const key of keys) {
    if (_.isArray(dataToSend[key])) {
      for (const element of dataToSend[key]) {
        await translateIdsToMedusaIds(element);
      }
    } else if (dataToSend[key] instanceof Object) {
      await translateIdsToMedusaIds(dataToSend[key]);
    } else if (key == "id") {
      dataToSend["medusa_id"] = dataToSend[key];
      delete dataToSend[key];
    }
  }
  return dataToSend;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}