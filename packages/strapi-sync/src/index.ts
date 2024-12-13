import { Module } from "@medusajs/framework/utils";
import { CmsModuleService } from "@services";

export * from "@utils";
export * from "@services";
export * from "@types";
export * from "@constants";
export * from "@workflows";

export const CMS_MODULE = "cms";
export default Module(CMS_MODULE, { service: CmsModuleService });
