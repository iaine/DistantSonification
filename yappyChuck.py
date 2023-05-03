'''
yappyChuck - yet another python pyChuck
File to stop and start service
'''

import os
import subprocess

from pythonosc import udp_client

class Server():

    def __init__(self, port_number) -> None:
        self.port = port_number
        self.process = None

    def start(self):
        try:
            self.process = subprocess.Popen(["chuck","server.ck"], shell=False)
            if not self.process.pid:
                raise Exception('No server')
            print(self.process.pid)
        except Exception as e:
            print("Server Error {}".format(e))

    def stop(self):
        pid =  self.process.pid
        self.process.terminate()

        #let's catch any zombies
        try:
            os.kill(pid, 0)
            self.process.kill()
            print("Forced kill")
        except OSError as e:
            print ("Terminated gracefully")

class Client():

    def __init__(self) -> None:
        self.host = '127.0.0.1'
        self.port = 5005

    def send(self, message):
        '''
           Function to send the message
        '''
        try:
            client = udp_client.SimpleUDPClient(self.host, self.port)
            client.send_message("/debug", message)
        except Exception as e:
            print("Client Exception {}".format(e))

if __name__ == "__main__":
    server = Server(5005)
    print(server.port)
    server.start()

    client = Client()
    client.send("edge:261.25:0.5:3:0.25")

    server.stop()
