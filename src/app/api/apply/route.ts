import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
function getResend() { return new Resend(process.env.RESEND_API_KEY); }

export async function POST(req: NextRequest) {
  const TO = process.env.NOTIFY_EMAIL || "jeff@consortiumnyc.com";
  const FROM = process.env.FROM_EMAIL || "Design Applications <notifications@consortiumnyc.com>";
  try {
    const formData = await req.formData();

    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const position = formData.get("position") as string;
    const borough = formData.get("borough") as string | null;
    const experience = formData.get("experience") as string | null;
    const portfolioUrl = formData.get("portfolioUrl") as string | null;
    const message = formData.get("message") as string | null;
    const resumeFile = formData.get("resume") as File | null;
    const portfolioFile = formData.get("portfolio") as File | null;

    if (!name || !email || !phone || !position) {
      return NextResponse.json(
        { error: "Name, email, phone, and position are required." },
        { status: 400 }
      );
    }

    const timestamp = Date.now();
    const safeName = name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();

    // Upload portfolio file to Supabase Storage
    let portfolioFileUrl = "";
    if (portfolioFile) {
      const ext = portfolioFile.name.split(".").pop() || "pdf";
      const path = `applications/${safeName}-${timestamp}/portfolio.${ext}`;
      const buffer = Buffer.from(await portfolioFile.arrayBuffer());

      const { error: uploadError } = await getSupabase().storage
        .from("uploads")
        .upload(path, buffer, {
          contentType: portfolioFile.type,
          upsert: true,
        });

      if (uploadError) {
        console.error("Portfolio upload error:", uploadError);
      } else {
        const { data: urlData } = getSupabase().storage
          .from("uploads")
          .getPublicUrl(path);
        portfolioFileUrl = urlData.publicUrl;
      }
    }

    // Upload resume to Supabase Storage
    let resumeUrl = "";
    if (resumeFile) {
      const resumeExt = resumeFile.name.split(".").pop() || "pdf";
      const resumePath = `applications/${safeName}-${timestamp}/resume.${resumeExt}`;
      const resumeBuffer = Buffer.from(await resumeFile.arrayBuffer());

      const { error: resumeError } = await getSupabase().storage
        .from("uploads")
        .upload(resumePath, resumeBuffer, {
          contentType: resumeFile.type,
          upsert: true,
        });

      if (resumeError) {
        console.error("Resume upload error:", resumeError);
      } else {
        const { data: resumeUrlData } = getSupabase().storage
          .from("uploads")
          .getPublicUrl(resumePath);
        resumeUrl = resumeUrlData.publicUrl;
      }
    }

    // Save application to Supabase
    const { error: dbError } = await getSupabase().from("applications").insert({
      name,
      email,
      phone,
      position,
      borough: borough || null,
      experience: experience || null,
      portfolio_url: portfolioUrl || portfolioFileUrl || null,
      resume_url: resumeUrl || null,
      message: message || null,
      source: "website",
    });

    if (dbError) {
      console.error("Supabase insert error:", dbError);
    }

    // Send email notification
    const rows = [
      ["Name", name],
      ["Email", email],
      ["Phone", phone],
      ["Position", position],
      ["Borough", borough],
      ["Experience", experience],
      ["Portfolio URL", portfolioUrl],
      ["Portfolio File", portfolioFileUrl ? `<a href="${portfolioFileUrl}" style="color:#d97706;">View Portfolio</a>` : null],
      ["Resume", resumeUrl ? `<a href="${resumeUrl}" style="color:#d97706;">Download Resume</a>` : "Not uploaded"],
      ["Message", message],
    ]
      .filter(([, val]) => val)
      .map(
        ([label, val]) =>
          `<tr>
            <td style="padding:8px 12px;font-weight:600;color:#334155;vertical-align:top;white-space:nowrap;">${label}</td>
            <td style="padding:8px 12px;color:#475569;">${val}</td>
          </tr>`
      )
      .join("");

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#92400e;padding:24px 32px;border-radius:12px 12px 0 0;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">
            New Job Application: ${escapeHtml(position)}
          </h1>
          <p style="margin:4px 0 0;color:#fde68a;font-size:14px;">TheNYCInteriorDesigner.com</p>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;padding:24px 32px;border-radius:0 0 12px 12px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;">
            ${rows}
          </table>
          <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;">Reply to this email to contact <strong>${escapeHtml(email)}</strong></p>
        </div>
      </div>
    `;

    try {
      await getResend().emails.send({
        from: FROM,
        to: TO,
        subject: `New Application: ${position} — ${name}`,
        html,
        replyTo: email,
      });
    } catch (emailErr) {
      console.error("Resend email error:", emailErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Application error:", err);
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
