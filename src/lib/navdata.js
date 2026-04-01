export const bundledNavData = {
  version: "2026-04-01-autorouter-faa-mvp",
  coverageNote:
    "Bundled data is only a starter set for demo routes. For operational use, extend it with licensed navdata and verified FIR itemA codes.",
  airports: {
    UBBB: {
      name: "Heydar Aliyev International Airport",
      city: "Baku",
      country: "Azerbaijan",
      fir: "Baku FIR",
      notamItemA: "UBBB",
      faaLocId: "UBBB"
    },
    VIDP: {
      name: "Indira Gandhi International Airport",
      city: "Delhi",
      country: "India",
      fir: "Delhi FIR",
      notamItemA: "VIDP",
      faaLocId: "VIDP"
    },
    VIJP: {
      name: "Jaipur International Airport",
      city: "Jaipur",
      country: "India",
      notamItemA: "VIJP",
      faaLocId: "VIJP"
    },
    VAAH: {
      name: "Sardar Vallabhbhai Patel International Airport",
      city: "Ahmedabad",
      country: "India",
      notamItemA: "VAAH",
      faaLocId: "VAAH"
    },
    OPKC: {
      name: "Jinnah International Airport",
      city: "Karachi",
      country: "Pakistan",
      fir: "Karachi FIR",
      notamItemA: "OPKC",
      faaLocId: "OPKC"
    },
    OPLA: {
      name: "Allama Iqbal International Airport",
      city: "Lahore",
      country: "Pakistan",
      fir: "Lahore FIR",
      notamItemA: "OPLA",
      faaLocId: "OPLA"
    },
    UBBG: {
      name: "Ganja International Airport",
      city: "Ganja",
      country: "Azerbaijan",
      notamItemA: "UBBG",
      faaLocId: "UBBG"
    },
    KJFK: {
      name: "John F. Kennedy International Airport",
      city: "New York",
      country: "United States",
      notamItemA: "KJFK",
      faaLocId: "JFK"
    }
  },
  waypoints: {
    BAMAK: {
      country: "Azerbaijan",
      fir: "Baku FIR"
    },
    PIROG: {
      country: "Azerbaijan",
      fir: "Baku FIR"
    },
    ULDUS: {
      country: "Azerbaijan",
      fir: "Baku FIR"
    },
    ZDN: {
      country: "Pakistan",
      fir: "Pakistan FIR"
    },
    LKA: {
      country: "India",
      fir: "Delhi FIR"
    },
    IGOLU: {
      country: "India"
    },
    DUDUM: {
      country: "India"
    },
    NIKOT: {
      country: "India"
    },
    UUD: {
      country: "India"
    }
  },
  airways: {
    T480: {
      countries: ["Azerbaijan"],
      firs: ["Baku FIR"]
    },
    N39: {
      countries: ["Azerbaijan"],
      firs: ["Baku FIR"]
    },
    N319: {
      countries: ["Pakistan"],
      firs: ["Pakistan FIR"]
    },
    G452: {
      countries: ["India"],
      firs: ["Delhi FIR"]
    },
    A474: {
      countries: ["India"]
    },
    M11: {
      countries: ["Azerbaijan"]
    },
    M747: {
      countries: ["Azerbaijan"]
    },
    R462: {
      countries: ["India"]
    }
  },
  procedures: {
    BAMAK1B: {
      kind: "SID",
      airport: "UBBB"
    },
    LKA7G: {
      kind: "STAR",
      airport: "VIDP"
    },
    DUDUM7B: {
      kind: "STAR",
      airport: "VIDP"
    }
  },
  manualAdvisories: [
    {
      selector: {
        country: "Azerbaijan"
      },
      level: "info",
      title: "Origin review",
      text: "Origin airport and origin FIR should still be checked against your official operational source."
    },
    {
      selector: {
        country: "Pakistan"
      },
      level: "review",
      title: "Overflight review",
      text: "Pakistan overflight was inferred from starter navdata. Add verified FIR itemA codes to improve live coverage."
    },
    {
      selector: {
        country: "India"
      },
      level: "info",
      title: "Destination review",
      text: "Destination, alternates and route-corridor NOTAMs should be confirmed with a licensed or official source."
    }
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSection(baseSection = {}, extraSection = {}) {
  return {
    ...baseSection,
    ...extraSection
  };
}

export function mergeNavData(extra = null) {
  const base = clone(bundledNavData);

  if (!extra || typeof extra !== "object") {
    return base;
  }

  return {
    ...base,
    ...extra,
    airports: mergeSection(base.airports, extra.airports),
    waypoints: mergeSection(base.waypoints, extra.waypoints),
    airways: mergeSection(base.airways, extra.airways),
    procedures: mergeSection(base.procedures, extra.procedures),
    manualAdvisories: [
      ...(base.manualAdvisories || []),
      ...(Array.isArray(extra.manualAdvisories) ? extra.manualAdvisories : [])
    ]
  };
}

export function summarizeCoverage(navData) {
  return {
    version: navData.version || "unknown",
    airports: Object.keys(navData.airports || {}).length,
    waypoints: Object.keys(navData.waypoints || {}).length,
    airways: Object.keys(navData.airways || {}).length,
    procedures: Object.keys(navData.procedures || {}).length,
    note: navData.coverageNote || ""
  };
}
