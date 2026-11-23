import type { Metadata } from "next";
import { Contact, LegalLayout, legalInfo } from "../legal/LegalLayout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacy Policy" };

export default async function PrivacyPage() {
  const { app, operator, email } = await legalInfo();
  return (
    <LegalLayout title="Privacy Policy" app={app}>
      <p>
        This policy explains what information the {app} content publishing service (the “Service”), operated by {operator}, accesses, why, and how you can control it.
      </p>

      <h2>1. Information we access</h2>
      <p>When an account owner connects TikTok or Instagram, the Service receives, through the platforms' official APIs:</p>
      <ul>
        <li><strong>Account basics:</strong> the account ID and username (TikTok scope <code>user.info.basic</code>; Instagram <code>instagram_business_basic</code>).</li>
        <li><strong>Access tokens</strong> that let the Service publish and read statistics on the owner's behalf.</li>
        <li><strong>Posts made by the Service and their statistics:</strong> views, likes, comments, shares, saves and average watch time (TikTok <code>video.list</code>; Instagram <code>instagram_business_manage_insights</code>).</li>
      </ul>
      <p>
        The Service does not access direct messages, followers' personal information, contacts, or any content from accounts that have not been connected by their owner.
      </p>

      <h2>2. How we use it</h2>
      <ul>
        <li>To publish videos the account operator has approved (TikTok <code>video.publish</code>; Instagram <code>instagram_business_content_publish</code>).</li>
        <li>To measure how those videos perform so we can decide what to make next.</li>
      </ul>
      <p>We do not sell this information, use it for advertising profiles, or share it with anyone except the service providers listed below.</p>

      <h2>3. Link clicks</h2>
      <p>
        Links in our profiles may pass through a redirect that records which video's link was clicked, the platform, and the time. It does not store IP addresses,
        cookies or any other information that identifies the visitor.
      </p>

      <h2>4. Storage and security</h2>
      <ul>
        <li>Access tokens and API keys are encrypted with AES-256-GCM before they are stored, and are only decrypted on our servers when needed.</li>
        <li>Data is stored with our infrastructure providers and is accessible only to the Service's operator.</li>
      </ul>

      <h2>5. Service providers</h2>
      <p>
        We use Supabase (database and file storage), Netlify (hosting), GitHub (scheduled jobs), Anthropic (AI used to write and review scripts; it receives
        video scripts and aggregated post statistics, not account tokens) and ElevenLabs (voice generation; it receives script text only).
      </p>

      <h2>6. Retention</h2>
      <p>
        Post statistics are kept while the account remains connected so performance can be compared over time. When an account is disconnected or we receive a
        deletion request, its tokens are deleted immediately and its statistics within 30 days.
      </p>

      <h2>7. Your choices</h2>
      <ul>
        <li><strong>TikTok:</strong> Settings and privacy → Security → Apps and services permissions → remove {app}.</li>
        <li><strong>Instagram:</strong> Settings → Website permissions → Apps and websites → remove {app}.</li>
        <li>
          To request a copy or deletion of data, <Contact email={email} operator={operator} />.
        </li>
      </ul>

      <h2>8. Children</h2>
      <p>The Service is not directed to children under 13 and does not knowingly process their information.</p>

      <h2>9. Changes</h2>
      <p>We may update this policy; the “Last updated” date above shows when it last changed.</p>

      <h2>10. Contact</h2>
      <p>
        {operator} — <Contact email={email} operator={operator} />.
      </p>
    </LegalLayout>
  );
}
