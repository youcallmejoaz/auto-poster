import type { Metadata } from "next";
import { Contact, LegalLayout, legalInfo } from "../legal/LegalLayout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Terms of Service" };

export default async function TermsPage() {
  const { app, operator, email } = await legalInfo();
  return (
    <LegalLayout title="Terms of Service" app={app}>
      <p>
        These terms govern the use of the {app} content publishing service (the “Service”), operated by {operator} (“we”, “us”). By connecting an account to the
        Service or using it, you agree to these terms.
      </p>

      <h2>1. What the Service does</h2>
      <p>
        The Service is a content tool operated by {operator}. It creates short-form videos about studying and {app}, and, with the account owner's authorization,
        publishes them to that owner's own TikTok and Instagram accounts and reads those posts' performance statistics. It is not a social network and does not
        publish content to accounts that have not been connected by their owner.
      </p>

      <h2>2. Connecting accounts</h2>
      <ul>
        <li>You may only connect TikTok or Instagram accounts that you own or are authorized to manage.</li>
        <li>You can disconnect at any time from within TikTok or Instagram (see our Privacy Policy), after which the Service can no longer post or read data.</li>
        <li>Your use of TikTok and Instagram remains subject to their own terms, including the TikTok Terms of Service and Meta's Terms and Platform Terms.</li>
      </ul>

      <h2>3. Content</h2>
      <ul>
        <li>Content published through the Service is reviewed and approved by the account operator before posting, unless the operator enables automatic approval.</li>
        <li>The account operator is responsible for content published to their accounts and for having the rights to any media, music or footage used.</li>
        <li>You must not use the Service to publish content that is unlawful, misleading, infringing, or that violates platform community guidelines.</li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>You must not misuse the Service, attempt to access it without authorization, interfere with its operation, or use it to send spam or automated engagement.</p>

      <h2>5. Availability and changes</h2>
      <p>
        The Service depends on third-party platforms and APIs that may change or become unavailable. We may modify, suspend or discontinue the Service at any time.
        We may update these terms; the “Last updated” date above shows when they last changed.
      </p>

      <h2>6. Disclaimer and limitation of liability</h2>
      <p>
        The Service is provided “as is” without warranties of any kind. To the fullest extent permitted by law, {operator} is not liable for any indirect, incidental
        or consequential damages, or for any loss of data, followers, revenue or reach arising from use of the Service.
      </p>

      <h2>7. Contact</h2>
      <p>
        For questions about these terms, <Contact email={email} operator={operator} />.
      </p>
    </LegalLayout>
  );
}
