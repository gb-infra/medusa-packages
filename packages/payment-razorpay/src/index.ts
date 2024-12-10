import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import {
  RazorpayBancontactService,
  RazorpayBlikService,
  RazorpayGiropayService,
  RazorpayIdealService,
  RazorpayProviderService,
  RazorpayPrzelewy24Service,
} from "./services";

const services = [
  RazorpayBancontactService,
  RazorpayBlikService,
  RazorpayGiropayService,
  RazorpayIdealService,
  RazorpayProviderService,
  RazorpayPrzelewy24Service,
];

export default ModuleProvider(Modules.PAYMENT, {
  services,
});
