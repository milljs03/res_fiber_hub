import pandas as pd

colspecs = [
    (0, 2),     # County Code
    (2, 6),     # Tax District
    (6, 24),    # Parcel Number
    (24, 27),   # Duplicate
    (27, 62),   # Property Address
    (62, 87),   # Property City
    (87, 89),   # Property State
    (89, 99),   # Property Zip
    (99, 149),  # Owner Name
    (149, 184), # Owner Address
    (184, 209), # Owner City
    (209, 219), # Owner Zip
    # additional fields continue...
]

df = pd.read_fwf("TAXDATA_Elkhart_20_2024p2025.txt", colspecs=colspecs, header=None)

df.to_csv("taxdata.csv", index=False)
