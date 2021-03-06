#!/usr/bin/perl

# simple perl script to extract frame data from the FrameFile.txt file into separate data files that can be steamed to the browser

use strict;
use FindBin qw($Bin);
use Data::Dumper;
chdir "$Bin/../" or die "could not chdir $Bin/../";

if (-d "data") {
  my @files = glob("data/*"); 
  unlink @files;
}
else {
  mkdir "data" or die "could not mkdir data";
}
open my $fh, "< $Bin/FrameFile.txt" or die;

my $headerline = <$fh>;
chomp $headerline;
die "expected line: Frame Data File\n" if $headerline ne 'Frame Data File';

my $totalframes = <$fh>;
chomp $totalframes;
die "expected totalframes > 0 - got: $totalframes" unless $totalframes > 0;

my $lastFrameNum = 0;
my $lastTotalParticles=0;
my $outfh;
my $foundParticlesInFrame=0;

my %found_collisions; # { <collisionId> => { <frame> => { <particleId> => <line> }, } }

my $lineNo = 0;
while (<$fh>) {
  ++$lineNo;
  my $line = $_;
  chomp $line;

  if ($line =~ /^(\d+)$/) {

    die "in frame $lastFrameNum, found $foundParticlesInFrame particles, should have been $lastTotalParticles\n" if $foundParticlesInFrame != $lastTotalParticles;

    my $frameNum = $1;
    die "expected frame num: ".($lastFrameNum + 1)." but got frameNum: $frameNum" unless (($lastFrameNum + 1) == $frameNum);
    my $totalParticles = <$fh>;
    chomp $totalParticles;
    die "expected totalParticles > 0" unless $totalParticles > 0;
    $lastTotalParticles = $totalParticles;
    $lastFrameNum = $frameNum;

    close $outfh if $outfh;
    open $outfh, "> data/$frameNum.txt" or die "could not write data/$frameNum.txt"; 
    print $outfh "framenum $frameNum/$totalframes\nframeparticles $totalParticles";
    $foundParticlesInFrame=0;
  }

  elsif ($line) {

    my ($particleId, $x, $y, $z, $radius, $color1, $color2, @collisions) = split /\ /, $line;

    foreach my $collisionId (@collisions) {
      $found_collisions{$lastFrameNum}{$collisionId}{$particleId} = [$x,$y,$z, $lineNo];
    }

    $foundParticlesInFrame++;
    print $outfh "\n".$line;
  }
}


print "Found Collisions\n";
print Dumper(\%found_collisions);
