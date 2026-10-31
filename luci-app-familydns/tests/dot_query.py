"""Send one DNS-over-TLS A query and print the answers: dot_query.py PORT SNI NAME CAFILE"""
import random
import socket
import ssl
import struct
import sys


def build_query(name):
    header = struct.pack(">HHHHHH", random.randrange(65536), 0x0100, 1, 0, 0, 0)
    labels = b"".join(bytes([len(p)]) + p.encode() for p in name.split("."))
    return header + labels + b"\x00" + struct.pack(">HH", 1, 1)


def a_records(data):
    count = struct.unpack(">H", data[6:8])[0]
    i = 12
    while data[i] != 0:
        i += data[i] + 1
    i += 5
    out = []
    for _ in range(count):
        if data[i] & 0xC0 == 0xC0:
            i += 2
        else:
            while data[i] != 0:
                i += data[i] + 1
            i += 1
        rtype, _cls, _ttl, length = struct.unpack(">HHIH", data[i:i + 10])
        i += 10
        if rtype == 1:
            out.append(".".join(str(b) for b in data[i:i + 4]))
        i += length
    return out


def main(port, sni, name, cafile):
    context = ssl.create_default_context(cafile=cafile)
    with socket.create_connection(("127.0.0.1", int(port)), timeout=15) as raw:
        with context.wrap_socket(raw, server_hostname=sni) as tls:
            query = build_query(name)
            tls.sendall(struct.pack(">H", len(query)) + query)
            length = struct.unpack(">H", tls.recv(2))[0]
            data = b""
            while len(data) < length:
                data += tls.recv(length - len(data))
    print(" ".join(a_records(data)))


if __name__ == "__main__":
    main(*sys.argv[1:5])
