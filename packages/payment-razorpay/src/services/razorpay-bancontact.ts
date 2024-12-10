import RazorpayBase from "../core/razorpay-base"
import { PaymentIntentOptions, PaymentProviderKeys } from "../types"

class BancontactProviderService extends RazorpayBase {
  static identifier = PaymentProviderKeys.BAN_CONTACT

  constructor(_, options) {
    super(_, options)
  }

  get paymentIntentOptions(): PaymentIntentOptions {
    return {
      payment_method_types: ["bancontact"],
      capture_method: "automatic",
    }
  }
}

export default BancontactProviderService
