Public OpenTimestamps interoperability fixtures. No real company data.

hello-world.txt.ots: unmodified proof from
https://github.com/opentimestamps/javascript-opentimestamps/blob/master/examples/hello-world.txt.ots
SHA-256 document digest: 03ba204e50d126e4674c005e04d82e84c21366780af1f43bd54a37816b6ab340

bitcoin-block.json: public Bitcoin block 358391 and its raw header, retrieved from
Blockstream's public Esplora API. Tests replay this response without network access.

live-pending.json: genuine receipt from the public Alice/Bob calendars for a
synthetic test message hash. Contains only digest/proof bytes, no company events.

calendar-upgrade.json: public Alice/Bob upgrade responses for live-pending.json
and matching Blockstream/mempool.space header responses for Bitcoin block 973889.
The intermediate calendar commitments are 44 bytes after append operations, not 32 bytes.
Captured to regress the detached-file codec wrapper without relying on live APIs.
