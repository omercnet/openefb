## Swift on-disk data generated from `full`

### Paths inside the app container (from the seed report)

- SwiftData store (`ModelConfiguration()` without URL): `/Users/runner/Library/Developer/CoreSimulator/Devices/222B2991-2A48-4FBB-883C-4389C1F5F4BF/data/Containers/Data/Application/1B4488A5-9FCE-40BE-918A-80178E5D5C84/Library/Application Support/default.store`
- Application Support: `/Users/runner/Library/Developer/CoreSimulator/Devices/222B2991-2A48-4FBB-883C-4389C1F5F4BF/data/Containers/Data/Application/1B4488A5-9FCE-40BE-918A-80178E5D5C84/Library/Application Support`

Files under Application Support after the seed run:

| path | bytes |
|---|---|
| default.store | 102400 |
| default.store-shm | 32768 |
| default.store-wal | 78312 |
| efb-212/recording.sqlite | 610304 |
| efb-212/recording.sqlite-shm | 32768 |
| efb-212/recording.sqlite-wal | 0 |

Model counts: {"AircraftProfile": 3, "FlightPlanRecord": 5, "FlightRecord": 10, "LogbookEntry": 20, "PilotProfile": 2, "UserSettings": 1}

### SwiftData store, live copy

Copied while the app was still running (-wal and -shm as an in-use store leaves them).

Files: `default.store` 102400 B, `default.store-shm` 32768 B, `default.store-wal` 78312 B

#### Core Data metadata

Core Data / SwiftData dates are REAL seconds since 2001-01-01T00:00:00Z (add 978307200 for Unix time)

`Z_PRIMARYKEY` (entity number -> table suffix, Z_MAX = last Z_PK handed out):

| Z_ENT | Z_NAME | Z_SUPER | Z_MAX |
|---|---|---|---|
| 1 | AircraftProfile | 0 | 3 |
| 2 | FlightPlanRecord | 0 | 5 |
| 3 | FlightRecord | 0 | 10 |
| 4 | LogbookEntry | 0 | 20 |
| 5 | PilotProfile | 0 | 2 |
| 6 | UserSettings | 0 | 1 |
| 16001 | CHANGE | 0 | 41 |
| 16002 | TRANSACTION | 0 | 1 |
| 16003 | TRANSACTIONSTRING | 0 | 2 |

`Z_METADATA`: Z_VERSION=1, Z_UUID=98760D68-38C4-41B3-A9BC-036668172CDA

Z_PLIST keys: `NSPersistenceFrameworkVersion`, `NSPersistenceMaximumFrameworkVersion`, `NSStoreModelVersionChecksumKey`, `NSStoreModelVersionHashes`, `NSStoreModelVersionHashesDigest`, `NSStoreModelVersionHashesVersion`, `NSStoreModelVersionIdentifiers`, `NSStoreType`, `_NSAutoVacuumLevel`
- `NSPersistenceFrameworkVersion`: 1526
- `NSPersistenceMaximumFrameworkVersion`: 1526
- `NSStoreModelVersionChecksumKey`: XW3qJLf/ywPFgkEuXE2URQV0FYpyQzQnUGOOhmmU5lI=
- `NSStoreModelVersionHashes`: 6 entries: AircraftProfile, FlightPlanRecord, FlightRecord, LogbookEntry, PilotProfile, UserSettings
- `NSStoreModelVersionHashesDigest`: CkEU8dcInPJKy8vrXIVp05PITyuFHgWCRhl1TffJDpC8ugT8SK+qcepxCC5/SmNfSSnkrb2N+I1sk5SiQVYpvw==
- `NSStoreModelVersionHashesVersion`: 3
- `NSStoreModelVersionIdentifiers`: ['1.0.0']
- `NSStoreType`: SQLite
- `_NSAutoVacuumLevel`: 2

`Z_MODELCACHE`: 1 row(s), 7411 bytes of cached model (ignore in the importer).

### SwiftData tables (`default.store`)

SQLite 3.54.1; page_size 4096; journal_mode wal; user_version 0

#### `ACHANGE` (41 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_PK | INTEGER |  |  | PK |
| Z_ENT | INTEGER |  |  |  |
| Z_OPT | INTEGER |  |  |  |
| ZCHANGETYPE | INTEGER |  |  |  |
| ZENTITY | INTEGER |  |  |  |
| ZENTITYPK | INTEGER |  |  |  |
| ZTRANSACTIONID | INTEGER |  |  |  |
| ZCOLUMNS | BLOB |  |  |  |

Indexes: `ACHANGE_ZTRANSACTIONID_INDEX`

First row: Z_PK=1; Z_ENT=16001; Z_OPT=NULL; ZCHANGETYPE=0; ZENTITY=2; ZENTITYPK=1; ZTRANSACTIONID=1; ZCOLUMNS=NULL

Stored types: Z_PK: integer; Z_ENT: integer; Z_OPT: null; ZCHANGETYPE: integer; ZENTITY: integer; ZENTITYPK: integer; ZTRANSACTIONID: integer; ZCOLUMNS: null

#### `ATRANSACTION` (1 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_PK | INTEGER |  |  | PK |
| Z_ENT | INTEGER |  |  |  |
| Z_OPT | INTEGER |  |  |  |
| ZAUTHORTS | INTEGER |  |  |  |
| ZBUNDLEIDTS | INTEGER |  |  |  |
| ZCONTEXTNAMETS | INTEGER |  |  |  |
| ZPROCESSIDTS | INTEGER |  |  |  |
| ZTIMESTAMP | FLOAT |  |  |  |
| ZAUTHOR | VARCHAR |  |  |  |
| ZBUNDLEID | VARCHAR |  |  |  |
| ZCONTEXTNAME | VARCHAR |  |  |  |
| ZPROCESSID | VARCHAR |  |  |  |
| ZQUERYGEN | BLOB |  |  |  |

Indexes: `Z_TRANSACTION_TransactionTimestampIndex`, `Z_TRANSACTION_TransactionAuthorIndex`, `ATRANSACTION_ZPROCESSIDTS_INDEX`, `ATRANSACTION_ZCONTEXTNAMETS_INDEX`, `ATRANSACTION_ZBUNDLEIDTS_INDEX`, `ATRANSACTION_ZAUTHORTS_INDEX`

First row: Z_PK=1; Z_ENT=16002; Z_OPT=NULL; ZAUTHORTS=NULL; ZBUNDLEIDTS=1; ZCONTEXTNAMETS=NULL; ZPROCESSIDTS=2; ZTIMESTAMP=815916287.922363; ZAUTHOR=NULL; ZBUNDLEID=NULL; ZCONTEXTNAME=NULL; ZPROCESSID=NULL; ZQUERYGEN=NULL

Stored types: Z_PK: integer; Z_ENT: integer; Z_OPT: null; ZAUTHORTS: null; ZBUNDLEIDTS: integer; ZCONTEXTNAMETS: null; ZPROCESSIDTS: integer; ZTIMESTAMP: real; ZAUTHOR: null; ZBUNDLEID: null; ZCONTEXTNAME: null; ZPROCESSID: null; ZQUERYGEN: null

#### `ATRANSACTIONSTRING` (2 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_PK | INTEGER |  |  | PK |
| Z_ENT | INTEGER |  |  |  |
| Z_OPT | INTEGER |  |  |  |
| ZNAME | VARCHAR |  |  |  |

Indexes: `Z_TRANSACTIONSTRING_UNIQUE_NAME` (unique)

First row: Z_PK=1; Z_ENT=16003; Z_OPT=NULL; ZNAME='io.omer.efb'

Stored types: Z_PK: integer; Z_ENT: integer; Z_OPT: null; ZNAME: text

#### `ZAIRCRAFTPROFILE` (3 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_PK | INTEGER |  |  | PK |
| Z_ENT | INTEGER |  |  |  |
| Z_OPT | INTEGER |  |  |  |
| ZISACTIVE | INTEGER |  |  |  |
| ZPERSONSONBOARD | INTEGER |  |  |  |
| ZANNUALDUE | TIMESTAMP |  |  |  |
| ZCREATEDAT | TIMESTAMP |  |  |  |
| ZCRUISESPEEDKTS | FLOAT |  |  |  |
| ZFUELBURNGPH | FLOAT |  |  |  |
| ZFUELCAPACITYGALLONS | FLOAT |  |  |  |
| ZTRANSPONDERDUE | TIMESTAMP |  |  |  |
| ZAIRCRAFTTYPE | VARCHAR |  |  |  |
| ZICAOTYPEDESIGNATOR | VARCHAR |  |  |  |
| ZNNUMBER | VARCHAR |  |  |  |
| ZID | BLOB |  |  |  |
| ZVSPEEDSDATA | BLOB |  |  |  |

First row: Z_PK=1; Z_ENT=1; Z_OPT=1; ZISACTIVE=1; ZPERSONSONBOARD=2; ZANNUALDUE=783388800; ZCREATEDAT=757468800; ZCRUISESPEEDKTS=115.0; ZFUELBURNGPH=9.5; ZFUELCAPACITYGALLONS=54.0; ZTRANSPONDERDUE=774748800; ZAIRCRAFTTYPE='C172S'; ZICAOTYPEDESIGNATOR='C172S'; ZNNUMBER='N100KF'; ZID=blob(16) 00000001000040008000000000000001; ZVSPEEDSDATA=blob(70) 7b227679223a37342c22766665223a38352c22767331223a json={"vy": 74, "vfe": 85, "vs1": 48, "vx": 62, "vr": 55, "va": 99, "vs0": 40, "vne":

Stored types: Z_PK: integer; Z_ENT: integer; Z_OPT: integer; ZISACTIVE: integer; ZPERSONSONBOARD: integer/null; ZANNUALDUE: integer/null; ZCREATEDAT: integer; ZCRUISESPEEDKTS: null/real; ZFUELBURNGPH: null/real; ZFUELCAPACITYGALLONS: null/real; ZTRANSPONDERDUE: integer/null; ZAIRCRAFTTYPE: text; ZICAOTYPEDESIGNATOR: null/text; ZNNUMBER: text; ZID: blob; ZVSPEEDSDATA: blob/null

#### `ZFLIGHTPLANRECORD` (5 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_PK | INTEGER |  |  | PK |
| Z_ENT | INTEGER |  |  |  |
| Z_OPT | INTEGER |  |  |  |
| ZCRUISEALTITUDE | INTEGER |  |  |  |
| ZCREATEDAT | TIMESTAMP |  |  |  |
| ZCRUISESPEEDKTS | FLOAT |  |  |  |
| ZDEPARTURELATITUDE | FLOAT |  |  |  |
| ZDEPARTURELONGITUDE | FLOAT |  |  |  |
| ZDESTINATIONLATITUDE | FLOAT |  |  |  |
| ZDESTINATIONLONGITUDE | FLOAT |  |  |  |
| ZESTIMATEDFUELGALLONS | FLOAT |  |  |  |
| ZESTIMATEDTIMESECONDS | FLOAT |  |  |  |
| ZFUELBURNGPH | FLOAT |  |  |  |
| ZLASTUSEDAT | TIMESTAMP |  |  |  |
| ZTOTALDISTANCENM | FLOAT |  |  |  |
| ZDEPARTUREICAO | VARCHAR |  |  |  |
| ZDEPARTURENAME | VARCHAR |  |  |  |
| ZDESTINATIONICAO | VARCHAR |  |  |  |
| ZDESTINATIONNAME | VARCHAR |  |  |  |
| ZNAME | VARCHAR |  |  |  |
| ZNOTES | VARCHAR |  |  |  |
| ZID | BLOB |  |  |  |

First row: Z_PK=1; Z_ENT=2; Z_OPT=1; ZCRUISEALTITUDE=3500; ZCREATEDAT=761875200; ZCRUISESPEEDKTS=110.0; ZDEPARTURELATITUDE=32.9811; ZDEPARTURELONGITUDE=35.5719; ZDESTINATIONLATITUDE=32.18; ZDESTINATIONLONGITUDE=34.8333; ZESTIMATEDFUELGALLONS=4.25; ZESTIMATEDTIMESECONDS=2340.0; ZFUELBURNGPH=9.5; ZLASTUSEDAT=762739200; ZTOTALDISTANCENM=65.0; ZDEPARTUREICAO='LLIB'; ZDEPARTURENAME='Rosh Pina'; ZDESTINATIONICAO='LLHZ'; ZDESTINATIONNAME='Herzliya'; ZNAME='LLIB to LLHZ'; ZNOTES=NULL; ZID=blob(16) 00000003000040008000000000000003

Stored types: Z_PK: integer; Z_ENT: integer; Z_OPT: integer; ZCRUISEALTITUDE: integer; ZCREATEDAT: integer; ZCRUISESPEEDKTS: real; ZDEPARTURELATITUDE: real; ZDEPARTURELONGITUDE: real; ZDESTINATIONLATITUDE: real; ZDESTINATIONLONGITUDE: real; ZESTIMATEDFUELGALLONS: null/real; ZESTIMATEDTIMESECONDS: real; ZFUELBURNGPH: null/real; ZLASTUSEDAT: integer; ZTOTALDISTANCENM: real; ZDEPARTUREICAO: text; ZDEPARTURENAME: text; ZDESTINATIONICAO: text; ZDESTINATIONNAME: text; ZNAME: null/text; ZNOTES: null/text; ZID: blob

#### `ZFLIGHTRECORD` (10 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_PK | INTEGER |  |  | PK |
| Z_ENT | INTEGER |  |  |  |
| Z_OPT | INTEGER |  |  |  |
| ZHASDEBRIEF | INTEGER |  |  |  |
| ZTRACKPOINTCOUNT | INTEGER |  |  |  |
| ZTRANSCRIPTSEGMENTCOUNT | INTEGER |  |  |  |
| ZCREATEDAT | TIMESTAMP |  |  |  |
| ZDURATIONSECONDS | FLOAT |  |  |  |
| ZENDDATE | TIMESTAMP |  |  |  |
| ZSTARTDATE | TIMESTAMP |  |  |  |
| ZAIRCRAFTPROFILEID | VARCHAR |  |  |  |
| ZARRIVALICAO | VARCHAR |  |  |  |
| ZARRIVALNAME | VARCHAR |  |  |  |
| ZAUDIOFILEURL | VARCHAR |  |  |  |
| ZAUDIOQUALITY | VARCHAR |  |  |  |
| ZDEPARTUREICAO | VARCHAR |  |  |  |
| ZDEPARTURENAME | VARCHAR |  |  |  |
| ZNOTES | VARCHAR |  |  |  |
| ZPILOTPROFILEID | VARCHAR |  |  |  |
| ZID | BLOB |  |  |  |

First row: Z_PK=1; Z_ENT=3; Z_OPT=1; ZHASDEBRIEF=0; ZTRACKPOINTCOUNT=0; ZTRANSCRIPTSEGMENTCOUNT=0; ZCREATEDAT=763977600; ZDURATIONSECONDS=3600.0; ZENDDATE=763981200; ZSTARTDATE=763977600; ZAIRCRAFTPROFILEID='00000001-0000-4000-8000-000000000001'; ZARRIVALICAO=NULL; ZARRIVALNAME=NULL; ZAUDIOFILEURL=NULL; ZAUDIOQUALITY='high'; ZDEPARTUREICAO=NULL; ZDEPARTURENAME=NULL; ZNOTES=NULL; ZPILOTPROFILEID='00000002-0000-4000-8000-000000000001'; ZID=blob(16) 00000004000040008000000000000006

Stored types: Z_PK: integer; Z_ENT: integer; Z_OPT: integer; ZHASDEBRIEF: integer; ZTRACKPOINTCOUNT: integer; ZTRANSCRIPTSEGMENTCOUNT: integer; ZCREATEDAT: integer; ZDURATIONSECONDS: real; ZENDDATE: integer/null; ZSTARTDATE: integer; ZAIRCRAFTPROFILEID: text; ZARRIVALICAO: null/text; ZARRIVALNAME: null/text; ZAUDIOFILEURL: null/text; ZAUDIOQUALITY: text; ZDEPARTUREICAO: null/text; ZDEPARTURENAME: null/text; ZNOTES: null/text; ZPILOTPROFILEID: text; ZID: blob

#### `ZLOGBOOKENTRY` (20 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_PK | INTEGER |  |  | PK |
| Z_ENT | INTEGER |  |  |  |
| Z_OPT | INTEGER |  |  |  |
| ZDAYLANDINGCOUNT | INTEGER |  |  |  |
| ZHASDEBRIEF | INTEGER |  |  |  |
| ZISCONFIRMED | INTEGER |  |  |  |
| ZNIGHTLANDINGCOUNT | INTEGER |  |  |  |
| ZCREATEDAT | TIMESTAMP |  |  |  |
| ZDATE | TIMESTAMP |  |  |  |
| ZDURATIONSECONDS | FLOAT |  |  |  |
| ZAIRCRAFTPROFILEID | VARCHAR |  |  |  |
| ZAIRCRAFTTYPE | VARCHAR |  |  |  |
| ZARRIVALICAO | VARCHAR |  |  |  |
| ZARRIVALNAME | VARCHAR |  |  |  |
| ZDEPARTUREICAO | VARCHAR |  |  |  |
| ZDEPARTURENAME | VARCHAR |  |  |  |
| ZNOTES | VARCHAR |  |  |  |
| ZPILOTPROFILEID | VARCHAR |  |  |  |
| ZROUTE | VARCHAR |  |  |  |
| ZFLIGHTID | BLOB |  |  |  |
| ZID | BLOB |  |  |  |

First row: Z_PK=1; Z_ENT=4; Z_OPT=1; ZDAYLANDINGCOUNT=3; ZHASDEBRIEF=0; ZISCONFIRMED=0; ZNIGHTLANDINGCOUNT=2; ZCREATEDAT=763862400; ZDATE=763862400; ZDURATIONSECONDS=2100.0; ZAIRCRAFTPROFILEID='00000001-0000-4000-8000-000000000003'; ZAIRCRAFTTYPE='SR22'; ZARRIVALICAO='KSQL'; ZARRIVALNAME='San Carlos'; ZDEPARTUREICAO='KPAO'; ZDEPARTURENAME='Palo Alto'; ZNOTES=NULL; ZPILOTPROFILEID='00000002-0000-4000-8000-000000000002'; ZROUTE=NULL; ZFLIGHTID=blob(16) 00000004000040008000000000000005; ZID=blob(16) 00000005000040008000000000000005

Stored types: Z_PK: integer; Z_ENT: integer; Z_OPT: integer; ZDAYLANDINGCOUNT: integer; ZHASDEBRIEF: integer; ZISCONFIRMED: integer; ZNIGHTLANDINGCOUNT: integer; ZCREATEDAT: integer; ZDATE: integer; ZDURATIONSECONDS: real; ZAIRCRAFTPROFILEID: text; ZAIRCRAFTTYPE: text; ZARRIVALICAO: null/text; ZARRIVALNAME: null/text; ZDEPARTUREICAO: null/text; ZDEPARTURENAME: null/text; ZNOTES: null/text; ZPILOTPROFILEID: text; ZROUTE: null/text; ZFLIGHTID: blob/null; ZID: blob

#### `ZPILOTPROFILE` (2 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_PK | INTEGER |  |  | PK |
| Z_ENT | INTEGER |  |  |  |
| Z_OPT | INTEGER |  |  |  |
| ZISACTIVE | INTEGER |  |  |  |
| ZCREATEDAT | TIMESTAMP |  |  |  |
| ZFLIGHTREVIEWDATE | TIMESTAMP |  |  |  |
| ZMEDICALEXPIRY | TIMESTAMP |  |  |  |
| ZTOTALHOURS | FLOAT |  |  |  |
| ZCERTIFICATENUMBER | VARCHAR |  |  |  |
| ZCERTIFICATETYPE | VARCHAR |  |  |  |
| ZEMAIL | VARCHAR |  |  |  |
| ZMEDICALCLASS | VARCHAR |  |  |  |
| ZNAME | VARCHAR |  |  |  |
| ZPHONE | VARCHAR |  |  |  |
| ZID | BLOB |  |  |  |
| ZNIGHTLANDINGENTRIESDATA | BLOB |  |  |  |

First row: Z_PK=1; Z_ENT=5; Z_OPT=1; ZISACTIVE=0; ZCREATEDAT=757468800; ZFLIGHTREVIEWDATE=NULL; ZMEDICALEXPIRY=NULL; ZTOTALHOURS=NULL; ZCERTIFICATENUMBER=NULL; ZCERTIFICATETYPE=NULL; ZEMAIL=NULL; ZMEDICALCLASS=NULL; ZNAME='Test Pilot Two'; ZPHONE=NULL; ZID=blob(16) 00000002000040008000000000000002; ZNIGHTLANDINGENTRIESDATA=NULL

Stored types: Z_PK: integer; Z_ENT: integer; Z_OPT: integer; ZISACTIVE: integer; ZCREATEDAT: integer; ZFLIGHTREVIEWDATE: integer/null; ZMEDICALEXPIRY: integer/null; ZTOTALHOURS: null/real; ZCERTIFICATENUMBER: null/text; ZCERTIFICATETYPE: null/text; ZEMAIL: null/text; ZMEDICALCLASS: null/text; ZNAME: text; ZPHONE: null/text; ZID: blob; ZNIGHTLANDINGENTRIESDATA: blob/null

#### `ZUSERSETTINGS` (1 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_PK | INTEGER |  |  | PK |
| Z_ENT | INTEGER |  |  |  |
| Z_OPT | INTEGER |  |  |  |
| ZCREATEDAT | TIMESTAMP |  |  |  |
| ZSECTIONALOPACITY | FLOAT |  |  |  |
| ZWEATHERREFRESHINTERVAL | FLOAT |  |  |  |
| ZACTIVEAIRCRAFTID | VARCHAR |  |  |  |
| ZACTIVEPILOTID | VARCHAR |  |  |  |
| ZDEFAULTMAPMODE | VARCHAR |  |  |  |
| ZLASTFLIGHTPLANID | VARCHAR |  |  |  |
| ZREGIONRAW | VARCHAR |  |  |  |

First row: Z_PK=1; Z_ENT=6; Z_OPT=1; ZCREATEDAT=757382400; ZSECTIONALOPACITY=0.55; ZWEATHERREFRESHINTERVAL=600.0; ZACTIVEAIRCRAFTID='00000001-0000-4000-8000-000000000001'; ZACTIVEPILOTID='00000002-0000-4000-8000-000000000001'; ZDEFAULTMAPMODE='trackUp'; ZLASTFLIGHTPLANID='00000003-0000-4000-8000-000000000002'; ZREGIONRAW='us'

Stored types: Z_PK: integer; Z_ENT: integer; Z_OPT: integer; ZCREATEDAT: integer; ZSECTIONALOPACITY: real; ZWEATHERREFRESHINTERVAL: real; ZACTIVEAIRCRAFTID: text; ZACTIVEPILOTID: text; ZDEFAULTMAPMODE: text; ZLASTFLIGHTPLANID: text; ZREGIONRAW: text

#### `Z_METADATA` (1 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_VERSION | INTEGER |  |  | PK |
| Z_UUID | VARCHAR(255) |  |  |  |
| Z_PLIST | BLOB |  |  |  |

First row: Z_VERSION=1; Z_UUID='98760D68-38C4-41B3-A9BC-036668172CDA'; Z_PLIST=blob(860) 62706c6973743030d90102030405060708090a0b0d0e0f10 bplist

Stored types: Z_VERSION: integer; Z_UUID: text; Z_PLIST: blob

#### `Z_MODELCACHE` (1 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_CONTENT | BLOB |  |  |  |

First row: Z_CONTENT=blob(7411) 8d9a077814d516c7ef94dd6cef6db2bda302d27bc0342040

Stored types: Z_CONTENT: blob

#### `Z_PRIMARYKEY` (9 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| Z_ENT | INTEGER |  |  | PK |
| Z_NAME | VARCHAR |  |  |  |
| Z_SUPER | INTEGER |  |  |  |
| Z_MAX | INTEGER |  |  |  |

First row: Z_ENT=1; Z_NAME='AircraftProfile'; Z_SUPER=0; Z_MAX=3

Stored types: Z_ENT: integer; Z_NAME: text; Z_SUPER: integer; Z_MAX: integer

### SwiftData store, closed copy

Copied after the app was terminated.

Files: `default.store` 102400 B, `default.store-shm` 32768 B, `default.store-wal` 78312 B

### GRDB recording database

Files: `recording.sqlite` 610304 B, `recording.sqlite-shm` 32768 B, `recording.sqlite-wal` 8272 B

### Recording tables (`efb-212/recording.sqlite`)

SQLite 3.54.1; page_size 4096; journal_mode wal; user_version 0

#### `debrief_results` (1 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| id | TEXT |  |  | PK |
| flightID | TEXT | NOT NULL |  |  |
| narrativeSummary | TEXT | NOT NULL |  |  |
| phaseObservationsJSON | TEXT | NOT NULL |  |  |
| improvementsJSON | TEXT | NOT NULL |  |  |
| overallRating | INTEGER | NOT NULL |  |  |
| generatedAt | REAL | NOT NULL |  |  |
| promptTokensEstimate | INTEGER |  |  |  |
| responseTokensEstimate | INTEGER |  |  |  |

Indexes: `idx_debrief_results_flight`, `sqlite_autoindex_debrief_results_1` (unique)

First row: id=blob(16) 00000132000040008000000000000000; flightID=blob(16) 00000004000040008000000000000001; narrativeSummary='Seed debrief narrative.'; phaseObservationsJSON='[]'; improvementsJSON='["Seed improvement"]'; overallRating=4; generatedAt='2025-03-13 09:06:40.000'; promptTokensEstimate=1200; responseTokensEstimate=300

Stored types: id: blob; flightID: blob; narrativeSummary: text; phaseObservationsJSON: text; improvementsJSON: text; overallRating: integer; generatedAt: text; promptTokensEstimate: integer; responseTokensEstimate: integer

#### `flight_route_legs` (1 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| flightID | TEXT | NOT NULL |  | PK |
| seq | INTEGER | NOT NULL |  | PK |
| fromCode | TEXT | NOT NULL |  |  |
| toCode | TEXT | NOT NULL |  |  |

Indexes: `sqlite_autoindex_flight_route_legs_1` (unique)

First row: flightID=blob(16) 00000004000040008000000000000001; seq=0; fromCode='LLHZ'; toCode='LLIB'

Stored types: flightID: blob; seq: integer; fromCode: text; toCode: text

#### `grdb_migrations` (5 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| identifier | TEXT | NOT NULL |  | PK |

Indexes: `sqlite_autoindex_grdb_migrations_1` (unique)

First row: identifier='v1'

Stored types: identifier: text

#### `phase_markers` (8 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| id | TEXT |  |  | PK |
| flightID | TEXT | NOT NULL |  |  |
| phase | TEXT | NOT NULL |  |  |
| startTimestamp | REAL | NOT NULL |  |  |
| endTimestamp | REAL |  |  |  |
| latitude | REAL | NOT NULL |  |  |
| longitude | REAL | NOT NULL |  |  |

Indexes: `idx_phase_markers_flight`, `sqlite_autoindex_phase_markers_1` (unique)

First row: id=blob(16) 000000ce000040008000000000000000; flightID=blob(16) 00000004000040008000000000000001; phase='preflight'; startTimestamp='2025-03-13 08:00:00.000'; endTimestamp='2025-03-13 08:06:40.000'; latitude=32.18; longitude=34.83

Stored types: id: blob; flightID: blob; phase: text; startTimestamp: text; endTimestamp: null/text; latitude: real; longitude: real

#### `track_points` (3600 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| id | TEXT |  |  | PK |
| flightID | TEXT | NOT NULL |  |  |
| timestamp | REAL | NOT NULL |  |  |
| latitude | REAL | NOT NULL |  |  |
| longitude | REAL | NOT NULL |  |  |
| altitudeFeet | REAL | NOT NULL |  |  |
| groundSpeedKnots | REAL | NOT NULL |  |  |
| verticalSpeedFPM | REAL | NOT NULL |  |  |
| courseDegrees | REAL | NOT NULL |  |  |

Indexes: `idx_track_points_flight`, `sqlite_autoindex_track_points_1` (unique)

First row: id=blob(16) 00000006000040008000000000000000; flightID=blob(16) 00000004000040008000000000000001; timestamp='2025-03-13 08:00:00.000'; latitude=32.18; longitude=34.8333; altitudeFeet=0.0; groundSpeedKnots=0.0; verticalSpeedFPM=500.0; courseDegrees=37.0

Stored types: id: blob; flightID: blob; timestamp: text; latitude: real; longitude: real; altitudeFeet: real; groundSpeedKnots: real; verticalSpeedFPM: real; courseDegrees: real

#### `transcript_segments` (12 rows)

| column | declared type | null | default | key |
|---|---|---|---|---|
| id | TEXT |  |  | PK |
| flightID | TEXT | NOT NULL |  |  |
| timestamp | REAL | NOT NULL |  |  |
| text | TEXT | NOT NULL |  |  |
| confidence | REAL |  |  |  |
| audioStartTime | REAL | NOT NULL |  |  |
| audioEndTime | REAL | NOT NULL |  |  |
| flightPhase | TEXT | NOT NULL |  |  |

Indexes: `idx_transcript_segments_flight`, `sqlite_autoindex_transcript_segments_1` (unique)

First row: id=blob(16) 0000006a000040008000000000000000; flightID=blob(16) 00000004000040008000000000000001; timestamp='2025-03-13 08:00:00.000'; text='Seed transcript segment 0'; confidence=NULL; audioStartTime=0.0; audioEndTime=5.0; flightPhase='preflight'

Stored types: id: blob; flightID: blob; timestamp: text; text: text; confidence: null/real; audioStartTime: real; audioEndTime: real; flightPhase: text

### UserDefaults: `closed/io.omer.efb.container.plist`

| key | plist type | value |
|---|---|---|
| displayMode | str | night |
| hasSeenOnboarding | bool | True |
| israel.routeNetwork.00000001-0000-4000-8000-000000000001 | str | cvfr |
| israel.routeNetwork.00000001-0000-4000-8000-000000000002 | str | lsa |
| israelChartHintDismissed | bool | True |
| israelNotamReadKeys | list | ['seed-notam-a', 'seed-notam-b'] |
| israelOffRouteThresholdNM | float | 2.5 |
| showAirportDiagrams | bool | False |
| showsFlightLog | bool | False |
| showsInstruments | bool | False |
| showsPredictions | bool | True |
| telemetryEnabled | bool | False |

### UserDefaults: `closed/io.omer.efb.defaults-export.plist`

| key | plist type | value |
|---|---|---|

### UserDefaults: `live/io.omer.efb.container.plist`

| key | plist type | value |
|---|---|---|
| displayMode | str | night |
| hasSeenOnboarding | bool | True |
| israel.routeNetwork.00000001-0000-4000-8000-000000000001 | str | cvfr |
| israel.routeNetwork.00000001-0000-4000-8000-000000000002 | str | lsa |
| israelChartHintDismissed | bool | True |
| israelNotamReadKeys | list | ['seed-notam-a', 'seed-notam-b'] |
| israelOffRouteThresholdNM | float | 2.5 |
| showAirportDiagrams | bool | False |
| showsFlightLog | bool | False |
| showsInstruments | bool | False |
| showsPredictions | bool | True |
| telemetryEnabled | bool | False |

### UserDefaults: `live/io.omer.efb.defaults-export.plist`

| key | plist type | value |
|---|---|---|

### Keychain generic-password items (attributes only)

| service | account | accessible | accessGroup / status |
|---|---|---|---|
|  |  |  | -34018 |

