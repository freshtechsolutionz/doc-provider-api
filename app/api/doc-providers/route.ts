import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const searchTerms: Record<string, string[]> = {
  all: [
    "Black doctor",
    "African American doctor",
    "doctor of color",
    "Latino doctor",
    "Hispanic doctor",
    "Black dentist",
    "Latino dentist",
    "Black therapist",
    "therapist of color",
    "Black OBGYN",
    "Latina OBGYN",
    "Black pediatrician",
    "Black dermatologist"
  ],
  doctor: ["Black primary care doctor", "Latino primary care doctor", "doctor of color"],
  dentist: ["Black dentist", "Latino dentist", "dentist of color"],
  therapist: ["Black therapist", "Latina therapist", "therapist of color"],
  obgyn: ["Black OBGYN", "Latina OBGYN", "OBGYN of color"],
  pediatrician: ["Black pediatrician", "Latino pediatrician"],
  dermatologist: ["Black dermatologist", "dermatologist of color", "skin of color dermatologist"],
  psychiatrist: ["Black psychiatrist", "Latino psychiatrist", "psychiatrist of color"],
  psychologist: ["Black psychologist", "Latino psychologist", "psychologist of color"],
  chiropractor: ["Black chiropractor", "Latino chiropractor"],
  optometrist: ["Black optometrist", "Latino optometrist"],
  nutritionist: ["Black nutritionist", "Latino nutritionist"]
};

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function searchGooglePlaces(lat: number, lng: number, specialty: string) {
  const terms = searchTerms[specialty] || searchTerms.all;
  const allResults: any[] = [];

  for (const term of terms) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount"
      },
      body: JSON.stringify({
        textQuery: term,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 80467
          }
        },
        maxResultCount: 20
      })
    });

    const data = await response.json();
    const places = data.places || [];

    for (const place of places) {
      allResults.push({
        name: place.displayName?.text || "Provider",
        specialty,
        displaySpecialty: specialty === "all" ? "Healthcare Provider" : specialty,
        address: place.formattedAddress || "",
        phone: place.nationalPhoneNumber || "",
        website: place.websiteUri || "",
        lat: place.location?.latitude,
        lng: place.location?.longitude,
        source: "Google Places",
        tags: [
          place.rating ? `${place.rating}★ rating` : "Local listing",
          place.userRatingCount ? `${place.userRatingCount} reviews` : term
        ]
      });
    }
  }

  const unique = new Map();
  for (const provider of allResults) {
    const key = `${provider.name}-${provider.address}`;
    if (!unique.has(key) && provider.lat && provider.lng) {
      unique.set(key, provider);
    }
  }

  return Array.from(unique.values());
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const specialty = searchParams.get("specialty") || "all";

  if (!lat || !lng) {
    return NextResponse.json({ error: "Missing lat or lng." }, { status: 400 });
  }

  const { data: verifiedProviders } = await supabase
    .from("doc_providers")
    .select("*")
    .eq("is_active", true);

  const verified = (verifiedProviders || [])
    .map((p) => ({
      name: p.name,
      specialty: p.specialty,
      displaySpecialty: p.display_specialty || p.specialty,
      address: p.address,
      phone: p.phone,
      website: p.website,
      lat: p.lat,
      lng: p.lng,
      source: p.source || "Verified DOC",
      tags: p.tags || ["Verified DOC"]
    }))
    .filter((p) => {
      if (!p.lat || !p.lng) return false;
      if (specialty !== "all" && p.specialty !== specialty) return false;
      return milesBetween(lat, lng, p.lat, p.lng) <= 50;
    });

  const googleProviders = await searchGooglePlaces(lat, lng, specialty);

  const combined = [...verified, ...googleProviders].filter((p) => {
    if (!p.lat || !p.lng) return false;
    return milesBetween(lat, lng, p.lat, p.lng) <= 50;
  });

  const unique = new Map();
  for (const provider of combined) {
    const key = `${provider.name}-${provider.address}`;
    if (!unique.has(key)) unique.set(key, provider);
  }

  return NextResponse.json({
    providers: Array.from(unique.values()).slice(0, 100)
  });
}